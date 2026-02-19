import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthForm } from '../components/auth/AuthForm';
import { useAuthStore } from '../stores/authStore';

// Mock the auth store
vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockClearError = vi.fn();

function setupMock(error: string | null = null) {
  const state = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error,
    login: mockLogin,
    register: mockRegister,
    logout: vi.fn(),
    updateProfile: vi.fn(),
    updatePresence: vi.fn(),
    setUser: vi.fn(),
    restoreSession: vi.fn(),
    clearError: mockClearError,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAuthStore).mockImplementation((selector?: any) => {
    if (typeof selector === 'function') return selector(state);
    return state;
  });
}

beforeEach(() => {
  mockLogin.mockReset();
  mockRegister.mockReset();
  mockClearError.mockReset();
  setupMock();
});

describe('AuthForm', () => {
  it('renders login form by default', () => {
    render(<AuthForm />);
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('switches to register form when toggle is clicked', async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Register'));
    expect(screen.getByText('Create an account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('switches back to login from register', async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Register'));
    await user.click(screen.getByText('Sign In'));
    expect(screen.getByText('Welcome back!')).toBeInTheDocument();
  });

  it('calls login with correct credentials', async () => {
    mockLogin.mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(mockLogin).toHaveBeenCalledWith({
      username: 'testuser',
      password: 'password123',
    });
  });

  it('calls register with correct data', async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Register'));
    await user.type(screen.getByLabelText('Username'), 'newuser');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(mockRegister).toHaveBeenCalledWith({
      username: 'newuser',
      email: undefined,
      password: 'password123',
    });
  });

  it('displays error message when present', () => {
    setupMock('Invalid credentials');
    render(<AuthForm />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('clears error when switching mode', async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Register'));
    expect(mockClearError).toHaveBeenCalled();
  });

  it('shows Together branding', () => {
    render(<AuthForm />);
    expect(screen.getByText('Together')).toBeInTheDocument();
  });
});
