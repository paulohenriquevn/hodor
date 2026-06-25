export default {
  plugins: {
    // Config resolvido a partir do cwd (raiz do repo, de onde os npm scripts rodam).
    tailwindcss: { config: "web/tailwind.config.js" },
    autoprefixer: {},
  },
};
