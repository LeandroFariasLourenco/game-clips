/**
 * Access Control Lock
 * Checks if the authenticated user matches the owner email specified in VITE_OWNER_EMAIL.
 * If unauthorized, forces immediate sign-out and denies access.
 */

export const DEFAULT_OWNER_EMAIL = 'feleolive2010@gmail.com';

export function getOwnerEmail(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OWNER_EMAIL) {
    return (import.meta.env.VITE_OWNER_EMAIL as string).trim().toLowerCase();
  }
  return DEFAULT_OWNER_EMAIL.toLowerCase();
}

export interface AccessCheckResult {
  isAuthorized: boolean;
  userEmail: string;
  expectedEmail: string;
  errorMessage?: string;
}

export function verifyUserAccess(userEmail: string | null | undefined): AccessCheckResult {
  const expectedEmail = getOwnerEmail();
  const normalizedUserEmail = (userEmail || '').trim().toLowerCase();

  if (!normalizedUserEmail) {
    return {
      isAuthorized: false,
      userEmail: '',
      expectedEmail,
      errorMessage: 'E-mail não fornecido. Autenticação obrigatória.',
    };
  }

  if (normalizedUserEmail === expectedEmail) {
    return {
      isAuthorized: true,
      userEmail: normalizedUserEmail,
      expectedEmail,
    };
  }

  return {
    isAuthorized: false,
    userEmail: normalizedUserEmail,
    expectedEmail,
    errorMessage: `Acesso Negado: O e-mail "${normalizedUserEmail}" não possui permissão para acessar esta biblioteca pessoal. Apenas "${expectedEmail}" está autorizado.`,
  };
}
