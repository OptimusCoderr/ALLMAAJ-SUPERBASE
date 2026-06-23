import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { AppRouter } from './routes';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppRouter />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
