import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import UpdateIcon from '@mui/icons-material/Update';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { loggedOut } from '../auth/authSlice';
import { api, useGetDashboardAnalyticsQuery } from '../../services/api';
import { formatStatusLabel, formatTimestamp } from '../../utils/format';
import KpiCards from './KpiCards';
import Charts from './Charts';
import ProjectTable from './ProjectTable';
import { useDashboardSocket } from './useDashboardSocket';

const FISCAL_PERIODS = [
  { value: 'all', label: 'All Periods' },
  { value: 'FY2024', label: 'FY2024' },
  { value: 'FY2025', label: 'FY2025' },
  { value: 'FY2026', label: 'FY2026' },
];

export default function DashboardPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);

  const [fiscalPeriod, setFiscalPeriod] = useState('all');

  // Open the real-time channel; it patches caches on server pushes.
  useDashboardSocket();

  const {
    data: analytics,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useGetDashboardAnalyticsQuery({ fiscal_period: fiscalPeriod });

  const handleLogout = () => {
    dispatch(loggedOut());
    // Drop cached API data so the next user starts clean.
    dispatch(api.util.resetApiState());
    navigate('/login', { replace: true });
  };

  const handlePeriodChange = (e: SelectChangeEvent) => {
    setFiscalPeriod(e.target.value);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="default" elevation={0}
        sx={{ borderBottom: '1px solid rgba(0,0,0,0.08)', bgcolor: 'background.paper' }}
      >
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <AccountBalanceIcon color="primary" />
          <Typography variant="h6" component="div" sx={{ mr: 2 }}>
            {user?.org_name ?? 'CapEx Platform'}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {user?.email}
            </Typography>
            {user?.role && (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={formatStatusLabel(user.role)}
              />
            )}
            <Button
              size="small"
              color="inherit"
              startIcon={<LogoutIcon />}
              onClick={handleLogout}
            >
              Logout
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Controls row: fiscal period + freshness */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          sx={{ mb: 3 }}
        >
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="fiscal-period-label">Fiscal Period</InputLabel>
            <Select
              labelId="fiscal-period-label"
              label="Fiscal Period"
              value={fiscalPeriod}
              onChange={handlePeriodChange}
            >
              {FISCAL_PERIODS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="When the analytics snapshot was generated">
              <Chip
                size="small"
                variant="outlined"
                icon={<UpdateIcon />}
                label={`Updated ${formatTimestamp(analytics?.generated_at)}`}
              />
            </Tooltip>
            {analytics?.stale && (
              <Tooltip title="Analytics may be out of date">
                <Chip
                  size="small"
                  color="warning"
                  icon={<WarningAmberIcon />}
                  label="Stale"
                />
              </Tooltip>
            )}
            <Button size="small" onClick={() => refetch()} disabled={isFetching}>
              Refresh
            </Button>
          </Stack>
        </Stack>

        {isError && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            action={
              <Button color="inherit" size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            Failed to load analytics.
          </Alert>
        )}

        {/* KPI cards */}
        <Box sx={{ mb: 3 }}>
          <KpiCards kpis={analytics?.kpis} loading={isLoading} />
        </Box>

        {/* Charts */}
        <Box sx={{ mb: 3 }}>
          <Charts data={analytics} loading={isLoading} />
        </Box>

        {/* Project table */}
        <ProjectTable role={user?.role} fiscalPeriod={fiscalPeriod} />
      </Container>
    </Box>
  );
}
