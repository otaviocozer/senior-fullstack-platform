import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type {
  DashboardAnalytics,
  LoginRequest,
  LoginResponse,
  Paginated,
  Project,
  ProjectListParams,
  ProjectStatus,
  Property,
  RefreshResponse,
  TransitionAction,
  TransitionRequest,
  User,
} from '../types';
import { loggedOut } from '../features/auth/authSlice';
import {
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '../features/auth/tokenStorage';

/** Resolved API base. Falls back to the Vite-proxied `/api` in dev. */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

/**
 * Predict the resulting status of a transition so we can update the UI
 * optimistically. The server remains the source of truth and reconciles.
 */
export function predictNextStatus(
  current: ProjectStatus,
  action: TransitionAction,
): ProjectStatus {
  if (action === 'reject') return 'rejected';
  if (action === 'submit') return current === 'draft' ? 'submitted' : current;
  // action === 'approve'
  switch (current) {
    case 'submitted':
      return 'manager_review';
    case 'manager_review':
      return 'finance_review';
    case 'finance_review':
      return 'approved';
    default:
      return current;
  }
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE,
  prepareHeaders: (headers) => {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

// Single-flight refresh: if several requests 401 at once, they all await the
// same refresh call instead of hammering the endpoint.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(
  api: Parameters<BaseQueryFn>[1],
  extraOptions: object,
): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  const result = await rawBaseQuery(
    {
      url: '/auth/refresh',
      method: 'POST',
      body: { refresh },
    },
    api,
    extraOptions,
  );

  const data = result.data as RefreshResponse | undefined;
  if (data?.access) {
    setTokens(data.access);
    return data.access;
  }
  return null;
}

/**
 * Wraps the base query so that a 401 triggers a token refresh and a single
 * retry. If the refresh fails, tokens are cleared and the user is logged out
 * (which causes ProtectedRoute to bounce to /login).
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // Coalesce concurrent refresh attempts.
    if (!refreshPromise) {
      refreshPromise = performRefresh(api, extraOptions).finally(() => {
        refreshPromise = null;
      });
    }
    const newAccess = await refreshPromise;

    if (newAccess) {
      // Retry the original request once with the fresh token.
      result = await rawBaseQuery(args, api, extraOptions);
    } else {
      clearAuthStorage();
      api.dispatch(loggedOut());
    }
  }

  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Project', 'Projects', 'Analytics', 'Property'],
  endpoints: (builder) => ({
    // --- Auth --------------------------------------------------------------
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    getMe: builder.query<User, void>({
      query: () => '/auth/me',
    }),

    // --- Properties --------------------------------------------------------
    getProperties: builder.query<Property[], void>({
      query: () => '/properties/',
      providesTags: ['Property'],
    }),

    // --- Projects ----------------------------------------------------------
    getProjects: builder.query<Paginated<Project>, ProjectListParams>({
      query: (params) => {
        const search = new URLSearchParams();
        if (params.page) search.set('page', String(params.page));
        if (params.page_size) search.set('page_size', String(params.page_size));
        if (params.status) search.set('status', params.status);
        if (params.category) search.set('category', params.category);
        if (params.property != null && params.property !== '')
          search.set('property', String(params.property));
        if (params.fiscal_period)
          search.set('fiscal_period', params.fiscal_period);
        if (params.search) search.set('search', params.search);
        const qs = search.toString();
        return `/projects/${qs ? `?${qs}` : ''}`;
      },
      providesTags: (result) =>
        result
          ? [
              ...result.results.map((p) => ({
                type: 'Project' as const,
                id: p.id,
              })),
              { type: 'Projects' as const, id: 'LIST' },
            ]
          : [{ type: 'Projects' as const, id: 'LIST' }],
    }),

    getProject: builder.query<Project, Project['id']>({
      query: (id) => `/projects/${id}/`,
      providesTags: (_r, _e, id) => [{ type: 'Project', id }],
    }),

    createProject: builder.mutation<Project, Partial<Project>>({
      query: (body) => ({ url: '/projects/', method: 'POST', body }),
      invalidatesTags: [
        { type: 'Projects', id: 'LIST' },
        'Analytics',
      ],
    }),

    updateProject: builder.mutation<
      Project,
      { id: Project['id']; patch: Partial<Project> }
    >({
      query: ({ id, patch }) => ({
        url: `/projects/${id}/`,
        method: 'PATCH',
        body: patch,
      }),
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Project', id: arg.id },
        { type: 'Projects', id: 'LIST' },
        'Analytics',
      ],
    }),

    deleteProject: builder.mutation<void, Project['id']>({
      query: (id) => ({ url: `/projects/${id}/`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Projects', id: 'LIST' }, 'Analytics'],
    }),

    /**
     * Advance a project through the approval state machine.
     *
     * Optimistic update: as soon as the transition is dispatched we patch the
     * project's status in every cached `getProjects` list so the row updates
     * immediately. On error we roll the patches back.
     */
    transitionProject: builder.mutation<Project, TransitionRequest>({
      query: ({ id, action }) => ({
        url: `/projects/${id}/transition/`,
        method: 'POST',
        body: { action },
      }),
      async onQueryStarted(
        { id, action },
        { dispatch, queryFulfilled, getState },
      ) {
        // Collect all cached getProjects entries so we patch every visible list.
        const state = getState() as unknown as {
          api: { queries: Record<string, { endpointName?: string } | undefined> };
        };
        const patches: Array<{ undo: () => void }> = [];

        for (const entry of Object.values(state.api.queries)) {
          if (entry?.endpointName !== 'getProjects') continue;
          // The originalArgs are stored on the cache entry.
          const originalArgs = (
            entry as unknown as { originalArgs: ProjectListParams }
          ).originalArgs;
          const patch = dispatch(
            api.util.updateQueryData(
              'getProjects',
              originalArgs,
              (draft) => {
                const row = draft.results.find((p) => p.id === id);
                if (row) {
                  row.status = predictNextStatus(row.status, action);
                }
              },
            ),
          );
          patches.push(patch);
        }

        try {
          const { data: updated } = await queryFulfilled;
          // Reconcile with the authoritative server row.
          for (const entry of Object.values(state.api.queries)) {
            if (entry?.endpointName !== 'getProjects') continue;
            const originalArgs = (
              entry as unknown as { originalArgs: ProjectListParams }
            ).originalArgs;
            dispatch(
              api.util.updateQueryData(
                'getProjects',
                originalArgs,
                (draft) => {
                  const idx = draft.results.findIndex((p) => p.id === id);
                  if (idx !== -1) draft.results[idx] = updated;
                },
              ),
            );
          }
          // Analytics almost certainly changed too.
          dispatch(api.util.invalidateTags(['Analytics']));
        } catch {
          // Roll back all optimistic patches on failure.
          patches.forEach((p) => p.undo());
        }
      },
      // Note: no invalidatesTags here — the row and analytics caches are
      // reconciled manually in onQueryStarted so the optimistic update is not
      // clobbered by an immediate refetch.
    }),

    // --- Analytics ---------------------------------------------------------
    getDashboardAnalytics: builder.query<
      DashboardAnalytics,
      { fiscal_period?: string }
    >({
      query: ({ fiscal_period }) => {
        const qs =
          fiscal_period && fiscal_period !== 'all'
            ? `?fiscal_period=${encodeURIComponent(fiscal_period)}`
            : '';
        return `/analytics/dashboard/${qs}`;
      },
      providesTags: ['Analytics'],
    }),
  }),
});

export const {
  useLoginMutation,
  useGetMeQuery,
  useGetPropertiesQuery,
  useGetProjectsQuery,
  useGetProjectQuery,
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  useTransitionProjectMutation,
  useGetDashboardAnalyticsQuery,
} = api;

/** Helper to force-refetch dashboard data from websocket-driven code. */
export const dashboardApiUtil = api.util;
