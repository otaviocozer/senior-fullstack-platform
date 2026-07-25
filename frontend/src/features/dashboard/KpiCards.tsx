import {
  Card,
  CardContent,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PaymentsIcon from '@mui/icons-material/Payments';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import FolderIcon from '@mui/icons-material/Folder';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ScheduleIcon from '@mui/icons-material/Schedule';
import type { AnalyticsKpis } from '../../types';
import {
  formatCount,
  formatCurrency,
  formatHours,
  formatPercent,
} from '../../utils/format';

interface KpiCardProps {
  label: string;
  value: string;
  icon: SvgIconComponent;
  /** Optional semantic color for the value text. */
  valueColor?: string;
  loading?: boolean;
}

function KpiCard({ label, value, icon: Icon, valueColor, loading }: KpiCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
          <Icon fontSize="small" color="action" />
          <Typography variant="subtitle2" color="text.secondary" noWrap>
            {label}
          </Typography>
        </Stack>
        {loading ? (
          <Skeleton width="70%" height={40} />
        ) : (
          <Typography
            variant="h5"
            sx={{ color: valueColor, fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

interface KpiCardsProps {
  kpis?: AnalyticsKpis;
  loading?: boolean;
}

/**
 * Row of six KPI cards. Variance is colored red when over budget (positive
 * variance = actual exceeds budget) and green when under.
 */
export default function KpiCards({ kpis, loading }: KpiCardsProps) {
  const variance = kpis?.variance_pct ?? 0;
  // Positive variance means actual exceeded budget -> over budget -> red.
  const varianceColor =
    variance > 0 ? '#c62828' : variance < 0 ? '#2e7d32' : undefined;

  const cards: KpiCardProps[] = [
    {
      label: 'Total Budget',
      value: formatCurrency(kpis?.total_budget),
      icon: AccountBalanceWalletIcon,
    },
    {
      label: 'Total Actual',
      value: formatCurrency(kpis?.total_actual),
      icon: PaymentsIcon,
    },
    {
      label: 'Variance %',
      value: formatPercent(kpis?.variance_pct),
      icon: TrendingUpIcon,
      valueColor: varianceColor,
    },
    {
      label: 'Projects',
      value: formatCount(kpis?.project_count),
      icon: FolderIcon,
    },
    {
      label: 'Pending Approvals',
      value: formatCount(kpis?.pending_approval),
      icon: HourglassTopIcon,
    },
    {
      label: 'Avg Cycle Time',
      value: formatHours(kpis?.avg_cycle_time_hours),
      icon: ScheduleIcon,
    },
  ];

  return (
    <Grid container spacing={2}>
      {cards.map((c) => (
        <Grid item xs={12} sm={6} md={4} lg={2} key={c.label}>
          <KpiCard {...c} loading={loading} />
        </Grid>
      ))}
    </Grid>
  );
}
