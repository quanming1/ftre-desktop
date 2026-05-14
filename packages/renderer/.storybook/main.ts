import type { StorybookConfig } from "@storybook/react-vite";
import path from "path";

const config: StorybookConfig = {
    stories: ["../src/**/*.stories.@(ts|tsx)"],
    addons: ["@storybook/addon-essentials"],
    framework: {
        name: "@storybook/react-vite",
        options: {},
    },
    viteFinal: async (config) => {
        config.resolve = config.resolve || {};
        config.resolve.alias = {
            ...config.resolve.alias,
            "@": path.resolve(__dirname, "../src"),
            "@ftre/ui/styles.css": path.resolve(__dirname, "../../ui/src/styles.css"),
            "@ftre/ui": path.resolve(__dirname, "../../ui/src/index.ts"),
        };
        return config;
    },
};

export default config;
