import { defineConfig } from 'tsdown'

/** Build the package root as a self-contained bundle (typert codegen runs via --config-loader native). */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
