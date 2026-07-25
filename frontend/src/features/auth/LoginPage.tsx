import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { useLoginMutation } from '../../services/api';
import { credentialsReceived } from './authSlice';

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAppSelector((s) => s.auth.user);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading }] = useLoginMutation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const from = (location.state as LocationState | null)?.from?.pathname || '/';

  // Already logged in — skip the form.
  if (user) return <Navigate to={from} replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const result = await login({ email, password }).unwrap();
      dispatch(credentialsReceived(result));
      navigate(from, { replace: true });
    } catch (err) {
      const status =
        typeof err === 'object' && err && 'status' in err
          ? (err as { status?: number | string }).status
          : undefined;
      setErrorMsg(
        status === 401 || status === 400
          ? 'Invalid email or password.'
          : 'Login failed. Please try again.',
      );
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        background:
          'linear-gradient(135deg, #e3f2fd 0%, #f4f6f8 60%, #e0f2f1 100%)',
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420 }} elevation={3}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} alignItems="center" sx={{ mb: 3 }}>
            <AccountBalanceIcon color="primary" sx={{ fontSize: 44 }} />
            <Typography variant="h5" component="h1" textAlign="center">
              CapEx Platform
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Budget &amp; approval analytics
            </Typography>
          </Stack>

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {errorMsg && <Alert severity="error">{errorMsg}</Alert>}
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                autoFocus
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={isLoading || !email || !password}
                startIcon={
                  isLoading ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : undefined
                }
              >
                {isLoading ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </Box>

          <Alert severity="info" variant="outlined" sx={{ mt: 3 }}>
            Seeded users use password <code>Passw0rd!</code> (e.g.{' '}
            <code>admin1@org1.example.com</code>).
          </Alert>
        </CardContent>
      </Card>
    </Box>
  );
}
