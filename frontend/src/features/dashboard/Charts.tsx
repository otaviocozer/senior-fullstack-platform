import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Skeleton,
  Typography,
} from '@mui/material';
import type { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardAnalytics } from '../../types';
import { formatCompactCurrency, formatStatusLabel } from '../../utils/format';

// Validated categorical palette (dataviz skill, light surface):
// slot 1 blue = budget, slot 2 green = actual. Single-series backlog uses blue.
const COLOR_BUDGET = '#2a78d6';
const COLOR_ACTUAL = '#008300';
const COLOR_SINGLE = '#2a78d6';
const AXIS_TEXT = '#898781';
const GRID = '#e1e0d9';

function ChartFrame({
  title,
  loading,
  hasData,
  children,
}: {
  title: string;
  loading?: boolean;
  hasData: boolean;
  children: ReactElement;
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardHeader
        title={title}
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
      />
      <CardContent sx={{ pt: 0 }}>
        <Box sx={{ width: '100%', height: 320 }}>
          {loading ? (
            <Skeleton variant="rounded" width="100%" height="100%" />
          ) : hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography color="text.secondary" variant="body2">
                No data for this period.
              </Typography>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

interface ChartsProps {
  data?: DashboardAnalytics;
  loading?: boolean;
}

export default function Charts({ data, loading }: ChartsProps) {
  const byCategory = data?.by_category ?? [];

  // Prefer backlog_by_level; fall back to by_status counts when absent/empty.
  const backlog = data?.backlog_by_level ?? [];
  const useBacklog = backlog.length > 0;
  const backlogData = useBacklog
    ? backlog.map((b) => ({ label: b.level, count: b.count }))
    : (data?.by_status ?? []).map((s) => ({
        label: formatStatusLabel(s.status),
        count: s.count,
      }));

  const currencyTick = (v: number) => formatCompactCurrency(v);

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={7}>
        <ChartFrame
          title="Budget vs Actual by Category"
          loading={loading}
          hasData={byCategory.length > 0}
        >
          <BarChart
            data={byCategory}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="category"
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={currencyTick}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              width={64}
            />
            <Tooltip
              formatter={(value: number) => formatCompactCurrency(value)}
            />
            <Legend />
            <Bar
              dataKey="budget"
              name="Budget"
              fill={COLOR_BUDGET}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
            <Bar
              dataKey="actual"
              name="Actual"
              fill={COLOR_ACTUAL}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ChartFrame>
      </Grid>

      <Grid item xs={12} md={5}>
        <ChartFrame
          title={
            useBacklog
              ? 'Approval Backlog by Level'
              : 'Projects by Status'
          }
          loading={loading}
          hasData={backlogData.length > 0}
        >
          <BarChart
            data={backlogData}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              width={40}
            />
            <Tooltip />
            <Bar
              dataKey="count"
              name="Count"
              fill={COLOR_SINGLE}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ChartFrame>
      </Grid>
    </Grid>
  );
}
