import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  corePlugins: {
    // Physical left/right utilities are disabled — this project uses CSS
    // logical properties exclusively so RTL (ar/ku) mirrors automatically.
    float: false,
  },
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          dark: "var(--color-primary-dark)",
        },
        accent: "var(--color-accent)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        neutral: {
          900: "var(--color-neutral-900)",
          100: "var(--color-neutral-100)",
          300: "var(--color-neutral-300)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
        arabic: ["var(--font-arabic)"],
      },
    },
  },
  plugins: [],
};

export default config;
