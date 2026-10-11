import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only cleans up on its own when tests run with globals, which these don't.
afterEach(cleanup);
