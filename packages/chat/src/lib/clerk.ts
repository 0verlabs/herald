import type { ClerkProviderProps } from "@clerk/react";

export const clerkAppearance: ClerkProviderProps["appearance"] = {
  theme: "simple",
  cssLayerName: "clerk",
  variables: {
    colorNeutral: "var(--primary)",
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorBackground: "var(--card)",
    colorForeground: "var(--card-foreground)",
    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorDanger: "var(--destructive)",
    borderRadius: "var(--radius)",
    fontFamily: "var(--font-sans)",
    fontFamilyMono: "var(--font-mono)",
  },
  elements: {
    cardBox: "border border-border shadow-sm",
    card: "bg-card",
    headerTitle: "font-heading text-2xl font-semibold tracking-tight",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton:
      "border-border bg-background hover:bg-muted text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
    socialButtonsIconButton:
      "border-border bg-background hover:bg-muted text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground",
    formFieldLabel: "text-foreground",
    formFieldInput: "border-border bg-background text-foreground placeholder:text-muted-foreground",
    formButtonPrimary: "shadow-xs hover:bg-primary/90",
    footerActionLink: "text-foreground underline underline-offset-4",
    footerActionText: "text-muted-foreground",
    footer: "bg-card border-t border-border",
    badge: "border-border bg-muted text-muted-foreground",
    identityPreviewBadge: "border-border bg-muted text-muted-foreground",
  },
};
