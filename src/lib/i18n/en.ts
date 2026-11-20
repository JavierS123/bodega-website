/**
 * English dictionary — the source of truth for the dictionary SHAPE.
 * `es.ts` must satisfy `Dictionary`, so a missing key there is a type error.
 */
export const en = {
  meta: {
    appName: "BodegaOS",
    tagline: "Inventory, AI cashier & business intelligence for a neighborhood shop",
  },
  demo: {
    banner: "Portfolio Demo Mode (Read-Only) — Live data, writes disabled.",
    simulatedWrite: "Demo mode: nothing was saved.",
  },
  nav: {
    dashboard: "Dashboard",
    inventory: "Inventory",
    transactions: "Transactions",
    clients: "Clients",
    owners: "Owners",
    analytics: "Analytics",
  },
  language: {
    label: "Language",
    switchTo: "Cambiar a español",
  },
  auth: {
    adminLogin: "Admin login",
    loginTitle: "Admin sign in",
    loginDescription: "Restricted to shop administrators. There is no public sign-up.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
    signedInAs: "Signed in as",
    adminBadge: "Admin",
    backToDemo: "Back to the live demo",
    errors: {
      invalidInput: "Enter a valid email and password.",
      invalidCredentials: "Invalid email or password.",
      notAdmin: "This account does not have admin access.",
      notConfigured: "Authentication is not configured on this deployment.",
      unknown: "Something went wrong. Please try again.",
    },
  },
  home: {
    title: "Welcome to BodegaOS",
    subtitle: "Phase 1 foundation is ready: database schema, admin auth, formatting and i18n.",
    sampleAmount: "Sample amount",
    today: "Today",
  },
  common: {
    loading: "Loading…",
  },
};

export type Dictionary = typeof en;
