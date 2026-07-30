// Test setup — runs before each test file
import path from 'path';
import fs from 'fs';

const TEST_DB_DIR = path.join(__dirname, '..', 'data-test');
if (fs.existsSync(TEST_DB_DIR)) {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DB_DIR, { recursive: true });
process.env.DB_DIR = TEST_DB_DIR;
process.env.JWT_SECRET = 'test-secret';
