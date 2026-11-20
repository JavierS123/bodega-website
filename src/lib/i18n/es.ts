import type { Dictionary } from "./en";

export const es: Dictionary = {
  meta: {
    appName: "BodegaOS",
    tagline: "Inventario, cajero con IA e inteligencia de negocio para una bodega de barrio",
  },
  demo: {
    banner: "Modo Demo de Portafolio (Solo lectura) — Datos en vivo, escritura deshabilitada.",
    simulatedWrite: "Modo demo: no se guardó nada.",
  },
  nav: {
    dashboard: "Inicio",
    inventory: "Inventario",
    transactions: "Transacciones",
    clients: "Clientes",
    owners: "Socios",
    analytics: "Analítica",
  },
  language: {
    label: "Idioma",
    switchTo: "Switch to English",
  },
  auth: {
    adminLogin: "Acceso admin",
    loginTitle: "Iniciar sesión (Admin)",
    loginDescription: "Solo para administradores de la bodega. No hay registro público.",
    email: "Correo",
    password: "Contraseña",
    signIn: "Entrar",
    signingIn: "Entrando…",
    signOut: "Cerrar sesión",
    signedInAs: "Sesión iniciada como",
    adminBadge: "Admin",
    backToDemo: "Volver a la demo en vivo",
    errors: {
      invalidInput: "Ingresa un correo y una contraseña válidos.",
      invalidCredentials: "Correo o contraseña incorrectos.",
      notAdmin: "Esta cuenta no tiene acceso de administrador.",
      notConfigured: "La autenticación no está configurada en este despliegue.",
      unknown: "Algo salió mal. Inténtalo de nuevo.",
    },
  },
  home: {
    title: "Bienvenido a BodegaOS",
    subtitle:
      "La base de la Fase 1 está lista: esquema de base de datos, auth de admin, formato e i18n.",
    sampleAmount: "Monto de ejemplo",
    today: "Hoy",
  },
  common: {
    loading: "Cargando…",
  },
};
