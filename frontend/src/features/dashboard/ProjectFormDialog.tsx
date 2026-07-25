import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  TextField,
} from '@mui/material';
import {
  useCreateProjectMutation,
  useGetPropertiesQuery,
  useUpdateProjectMutation,
} from '../../services/api';
import type { Project } from '../../types';

const FISCAL_PERIODS = ['FY2024', 'FY2025', 'FY2026'];
const CATEGORIES = [
  'HVAC', 'Roofing', 'Electrical', 'Plumbing', 'Elevator',
  'Landscaping', 'Security', 'Renovation', 'IT', 'Other',
];

interface FormState {
  title: string;
  property_id: string;
  category: string;
  fiscal_period: string;
  budget_amount: string;
  actual_cost: string;
}

const EMPTY: FormState = {
  title: '', property_id: '', category: 'HVAC',
  fiscal_period: 'FY2025', budget_amount: '', actual_cost: '0',
};

interface Props {
  open: boolean;
  /** When set, the dialog edits this project; otherwise it creates a new one. */
  project: Project | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export default function ProjectFormDialog({ open, project, onClose, onSaved }: Props) {
  const isEdit = !!project;
  const { data: properties = [] } = useGetPropertiesQuery();
  const [createProject, { isLoading: creating }] = useCreateProjectMutation();
  const [updateProject, { isLoading: updating }] = useUpdateProjectMutation();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the dialog opens (for create) or targets a project (edit).
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (project) {
      setForm({
        title: project.title,
        property_id: String(project.property_id),
        category: project.category,
        fiscal_period: project.fiscal_period,
        budget_amount: String(project.budget_amount),
        actual_cost: String(project.actual_cost),
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, project]);

  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const saving = creating || updating;

  const handleSubmit = async () => {
    setError(null);
    if (!form.title.trim() || !form.property_id || form.budget_amount === '') {
      setError('Title, property and budget are required.');
      return;
    }
    const payload = {
      title: form.title.trim(),
      property_id: Number(form.property_id),
      category: form.category,
      fiscal_period: form.fiscal_period,
      budget_amount: Number(form.budget_amount),
      actual_cost: Number(form.actual_cost || '0'),
    };
    try {
      if (isEdit && project) {
        await updateProject({ id: project.id, patch: payload }).unwrap();
        onSaved('Project updated.');
      } else {
        await createProject(payload).unwrap();
        onSaved('Project created.');
      }
      onClose();
    } catch (err) {
      const data =
        typeof err === 'object' && err && 'data' in err
          ? (err as { data?: unknown }).data
          : undefined;
      setError(
        typeof data === 'object' && data
          ? Object.entries(data as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
              .join(' · ')
          : 'Could not save the project.',
      );
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Edit project' : 'New project'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Grid container spacing={2} sx={{ mt: 0 }}>
          <Grid item xs={12}>
            <TextField label="Title" fullWidth size="small" value={form.title}
              onChange={set('title')} autoFocus />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Property" select fullWidth size="small"
              value={form.property_id} onChange={set('property_id')}
              // Editing a project's property is allowed only among your entitled ones.
              helperText={properties.length ? '' : 'No properties available'}>
              {properties.map((p) => (
                <MenuItem key={p.id} value={String(p.id)}>{p.name} ({p.code})</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Category" select fullWidth size="small"
              value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Fiscal period" select fullWidth size="small"
              value={form.fiscal_period} onChange={set('fiscal_period')}>
              {FISCAL_PERIODS.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Budget" type="number" fullWidth size="small"
              value={form.budget_amount} onChange={set('budget_amount')} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Actual cost" type="number" fullWidth size="small"
              value={form.actual_cost} onChange={set('actual_cost')} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
