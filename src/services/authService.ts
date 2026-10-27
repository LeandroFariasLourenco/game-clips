import { UserSession } from '../types/game';
import { getOwnerEmail } from '../utils/accessControl';

const DEFAULT_LOCAL_SESSION: UserSession = {
  email: getOwnerEmail(),
  displayName: 'Proprietário da Biblioteca',
  uid: 'local-owner',
  isOwner: true,
};

class AuthService {
  private currentSession: UserSession | null = DEFAULT_LOCAL_SESSION;
  private listeners: Array<(session: UserSession | null) => void> = [];

  public getSession(): UserSession | null {
    return this.currentSession;
  }

  public subscribe(cb: (session: UserSession | null) => void): () => void {
    this.listeners.push(cb);
    cb(this.currentSession);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public async signOut(): Promise<void> {
    // Autenticação oculta no modo 100% local
  }
}

export const authService = new AuthService();
