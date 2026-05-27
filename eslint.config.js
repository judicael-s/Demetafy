import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'data/**',
      'coverage/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
);
