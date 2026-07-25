import { useEffect, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { useGetMeQuery } from '../../services/api';
import { getAccessToken } from './tokenStorage';
import { markInitialized, userLoaded } from './authSlice';

/**
 * Guards routes behind authentication.
 *
 * - If there's a cached user in Redux, render immediately.
 * - If we have a token but no user yet, verify it via /auth/me.
 * - Otherwise redirect to /login (remembering where we came from).
 */
export default function ProtectedRoute({
  children,
}: {
  children: ReactElement;
}) {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const user = useAppSelector((s) => s.auth.user);
  const hasToken = Boolean(getAccessToken());

  // Only fetch /auth/me when we have a token but no user object cached.
  const shouldVerify = hasToken && !user;
  const { data, isLoading, isError } = useGetMeQuery(undefined, {
    skip: !shouldVerify,
  });

  useEffect(() => {
    if (data) dispatch(userLoaded(data));
    else if (isError) dispatch(markInitialized());
  }, [data, isError, dispatch]);

  // No token at all → straight to login.
  if (!hasToken && !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Verifying an existing token.
  if (shouldVerify && isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // Verification failed (token invalid and refresh couldn't save it).
  if (shouldVerify && isError && !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
