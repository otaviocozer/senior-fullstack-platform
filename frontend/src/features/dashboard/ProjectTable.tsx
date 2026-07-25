import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { SelectChangeEvent } from '@mui/material';
import {
  useDeleteProjectMutation,
  useGetProjectsQuery,
  useTransitionProjectMutation,
} from '../../services/api';
import type {
  Project,
  ProjectStatus,
  Role,
  TransitionAction,
} from '../../types';
import {
  formatCurrency,
  formatPercent,
  formatStatusLabel,
} from '../../utils/format';
import { availableActions, canAct, canManage, statusChipColor } from './transitions';
import ProjectFormDialog from './ProjectFormDialog';

const STATUS_OPTIONS: ProjectStatus[] = [
  'draft',
  'submitted',
  'manager_review',
  'finance_review',
  'approved',
  'rejected',
];

// Common CapEx categories for the filter dropdown. Any category present in the
// current results is merged in so custom categories remain filterable.
const BASE_CATEGORIES = [
  'HVAC',
  'Roofing',
  'Electrical',
  'Plumbing',
  'Elevator',
  'Landscaping',
  'Security',
  'Renovation',
  'IT',
  'Other',
];

interface ProjectTableProps {
  role: Role | undefined;
  fiscalPeriod: string; // '' or 'all' means no fiscal filter
}

export default function ProjectTable({ role, fiscalPeriod }: ProjectTableProps) {
  const [page, setPage] = useState(0); // zero-based for MUI
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, isError, refetch } = useGetProjectsQuery({
    page: page + 1, // API is one-based
    page_size: pageSize,
    status: status || undefined,
    category: category || undefined,
    fiscal_period:
      fiscalPeriod && fiscalPeriod !== 'all' ? fiscalPeriod : undefined,
    search: search || undefined,
  });

  const [transition] = useTransitionProjectMutation();
  const [deleteProject] = useDeleteProjectMutation();
  const [actingId, setActingId] = useState<Project['id'] | null>(null);
  const [snack, setSnack] = useState<{
    msg: string;
    severity: 'success' | 'error' | 'warning';
  } | null>(null);

  // CRUD dialog state (create/edit share one dialog; delete has a confirm).
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (project: Project) => {
    setEditing(project);
    setFormOpen(true);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id).unwrap();
      setSnack({ msg: 'Project deleted.', severity: 'success' });
      setDeleteTarget(null);
    } catch {
      setSnack({ msg: 'Delete failed. Please try again.', severity: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const rows = data?.results ?? [];
  const total = data?.count ?? 0;

  const categoryOptions = useMemo(() => {
    const set = new Set<string>(BASE_CATEGORIES);
    rows.forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [rows]);

  const showActions = canAct(role);
  const showManage = canManage(role);

  const handleAction = async (project: Project, action: TransitionAction) => {
    setActingId(project.id);
    try {
      await transition({ id: project.id, action }).unwrap();
      setSnack({ msg: 'Project updated.', severity: 'success' });
    } catch {
      setSnack({ msg: 'Action failed. Please try again.', severity: 'error' });
    } finally {
      setActingId(null);
    }
  };

  const handleStatusChange = (e: SelectChangeEvent) => {
    setStatus(e.target.value as ProjectStatus | '');
    setPage(0);
  };
  const handleCategoryChange = (e: SelectChangeEvent) => {
    setCategory(e.target.value);
    setPage(0);
  };

  return (
    <Card sx={{ p: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          Projects
        </Typography>
        {showManage && (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={openCreate}
          >
            New Project
          </Button>
        )}
      </Stack>

      {/* Filters */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel id="status-filter-label">Status</InputLabel>
            <Select
              labelId="status-filter-label"
              label="Status"
              value={status}
              onChange={handleStatusChange}
            >
              <MenuItem value="">
                <em>All statuses</em>
              </MenuItem>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {formatStatusLabel(s)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={4} md={3}>
          <FormControl fullWidth size="small">
            <InputLabel id="category-filter-label">Category</InputLabel>
            <Select
              labelId="category-filter-label"
              label="Category"
              value={category}
              onChange={handleCategoryChange}
            >
              <MenuItem value="">
                <em>All categories</em>
              </MenuItem>
              {categoryOptions.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={4} md={4}>
          <TextField
            fullWidth
            size="small"
            label="Search"
            placeholder="Title, property…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </Grid>
      </Grid>

      {isError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Failed to load projects.
        </Alert>
      ) : (
        <TableContainer sx={{ position: 'relative' }}>
          {isFetching && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                pt: 2,
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              <CircularProgress size={22} />
            </Box>
          )}
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Property</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Fiscal Period</TableCell>
                <TableCell align="right">Budget</TableCell>
                <TableCell align="right">Actual</TableCell>
                <TableCell align="right">Variance</TableCell>
                <TableCell>Status</TableCell>
                {showActions && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={showActions ? 9 : 8}>
                    <Typography
                      color="text.secondary"
                      variant="body2"
                      sx={{ py: 3, textAlign: 'center' }}
                    >
                      No projects match your filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((p) => {
                const actions = availableActions(p.status);
                const isActing = actingId === p.id;
                return (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.title}</TableCell>
                    <TableCell>{p.property_name}</TableCell>
                    <TableCell>{p.category}</TableCell>
                    <TableCell>{p.fiscal_period}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(p.budget_amount)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(p.actual_cost)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        color:
                          p.variance_pct > 0
                            ? 'error.main'
                            : p.variance_pct < 0
                            ? 'success.main'
                            : 'text.primary',
                      }}
                    >
                      {formatPercent(p.variance_pct)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={formatStatusLabel(p.status)}
                        color={statusChipColor(p.status)}
                      />
                    </TableCell>
                    {showActions && (
                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          justifyContent="flex-end"
                        >
                          {actions.length === 0 && !showManage ? (
                            <Typography
                              variant="caption"
                              color="text.disabled"
                            >
                              —
                            </Typography>
                          ) : (
                            actions.map((a) => (
                              <Button
                                key={a.action}
                                size="small"
                                variant={
                                  a.action === 'reject'
                                    ? 'outlined'
                                    : 'contained'
                                }
                                color={a.color}
                                disabled={isActing}
                                onClick={() => handleAction(p, a.action)}
                              >
                                {a.label}
                              </Button>
                            ))
                          )}
                          {showManage && (
                            <>
                              <Tooltip title="Edit">
                                <IconButton
                                  size="small"
                                  aria-label="edit project"
                                  onClick={() => openEdit(p)}
                                >
                                  <EditOutlinedIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete">
                                <IconButton
                                  size="small"
                                  color="error"
                                  aria-label="delete project"
                                  onClick={() => setDeleteTarget(p)}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_e, newPage) => setPage(newPage)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => {
          setPageSize(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50]}
      />

      {/* Create / edit dialog (managers only). */}
      <ProjectFormDialog
        open={formOpen}
        project={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => setSnack({ msg, severity: 'success' })}
      />

      {/* Delete confirmation. */}
      <Dialog open={!!deleteTarget} onClose={() => (deleting ? null : setDeleteTarget(null))}>
        <DialogTitle>Delete project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{deleteTarget?.title}” will be permanently deleted. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={confirmDelete} color="error" variant="contained" disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert
            severity={snack.severity}
            onClose={() => setSnack(null)}
            variant="filled"
          >
            {snack.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Card>
  );
}
