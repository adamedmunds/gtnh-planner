/** Loads a git-ignored `.env` from the project root, if there is one, so machine paths stay out of the repo. */
export function loadLocalEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env: rely on flags and the real environment
  }
}
