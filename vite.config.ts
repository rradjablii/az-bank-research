import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'charts', test: /node_modules[\\/](recharts|d3-|victory-vendor)/ }],
        },
      },
    },
  },
});
