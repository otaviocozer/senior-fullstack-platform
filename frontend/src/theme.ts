import { createTheme } from '@mui/material/styles';

// A clean, professional light theme for the analytics dashboard.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#00897b' },
    background: {
      default: '#f4f6f8',
      paper: '#ffffff',
    },
    success: { main: '#2e7d32' },
    error: { main: '#c62828' },
    warning: { main: '#ed6c02' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '"Inter","Roboto","Helvetica","Arial",sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    subtitle2: { fontWeight: 600 },
  },
  components: {
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid rgba(0,0,0,0.08)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
  },
});

export default theme;
