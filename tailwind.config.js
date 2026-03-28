/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#3b82f6", // blue-500
        secondary: "#10b981", // emerald-500
        dark: "#1e293b", // slate-800
        light: "#f8fafc", // slate-50
      }
    },
  },
  plugins: [],
}
