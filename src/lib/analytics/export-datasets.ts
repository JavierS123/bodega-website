/** Datasets the CSV export can produce (client-safe list shared by the menu and the route). */
export const EXPORT_DATASETS = ["sales", "daily", "products", "owners", "payments", "velocity", "watchlist"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
