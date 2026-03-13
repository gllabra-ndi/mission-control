import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#0E0F11",
                surface: "#1A1B1E",
                "surface-hover": "#25262B",
                border: "#2A2B2E",
                primary: "#5E6AD2",
                "primary-hover": "#6B78E0",
                text: {
                    main: "#EEEEEE",
                    muted: "#8A8F98",
                },
            },
            backgroundImage: {
                "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
            },
            boxShadow: {
                glow: "0 0 20px rgba(94, 106, 210, 0.15)",
                card: "0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)",
            },
        },
    },
    plugins: [],
};
export default config;
