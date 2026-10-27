import './styles/admin.css';
import { adminPage } from './admin-page.ts';

/**
 * The ideas board's admin page, for Steve alone (admin-page.ts). It loads after main.ts, as every
 * page does, which brings the site's own styles.
 */
for (const root of document.querySelectorAll<HTMLElement>('[data-admin]')) void adminPage(root);
