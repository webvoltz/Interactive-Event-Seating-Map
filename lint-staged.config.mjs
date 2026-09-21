export default {
  '*.{cjs,js,jsx,mjs,ts,tsx}': ['eslint --fix --max-warnings=0', 'prettier --write'],
  '*.{json,css,scss,sass,less,md,mdx,yaml,yml}': 'prettier --write',
};
