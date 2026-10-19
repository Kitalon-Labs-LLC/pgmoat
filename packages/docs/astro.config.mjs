import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = process.env.PGMOAT_SITE_URL || 'https://pgmoat.dev';

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'pgmoat',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          link: 'https://github.com/kitalonlabs/pgmoat',
        },
      ],
      sidebar: [
        {
          label: 'Get started',
          items: [
            { label: 'Quickstart', link: '/getting-started/quickstart/' },
            { label: 'Claude Desktop', link: '/getting-started/claude-desktop/' },
            { label: 'Claude Code, Cursor, VS Code', link: '/getting-started/claude-code-cursor-vscode/' },
            { label: 'Migrating from server-postgres', link: '/getting-started/migrate-from-server-postgres/' },
          ],
        },
        {
          label: 'Configure',
          items: [
            { label: 'pgmoat.yaml reference', link: '/reference/config/' },
            { label: 'Annotations', link: '/configure/annotations/' },
            { label: 'Budgets', link: '/configure/budgets/' },
            { label: 'Row-level security', link: '/configure/rls/' },
            { label: 'HTTP and OAuth', link: '/configure/http-oauth/' },
          ],
        },
        {
          label: 'Safety',
          items: [
            { label: 'Guarantees and limits', link: '/safety/guarantees/' },
            { label: 'Safety pipeline', link: '/safety/pipeline/' },
            { label: 'Allowed functions', link: '/safety/functions/' },
            { label: 'Prompt injection', link: '/safety/prompt-injection/' },
            { label: 'Threat model', link: '/safety/threat-model/' },
            { label: 'Role setup', link: '/safety/role-setup/' },
          ],
        },
        {
          label: 'Audit',
          items: [
            { label: 'Overview & Verification', link: '/audit/overview/' },
          ],
        },
        {
          label: 'Operate',
          items: [
            { label: 'Deployment patterns', link: '/operate/deployment-patterns/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', link: '/reference/cli/' },
            { label: 'Config schema', link: '/reference/config/' },
            {
              label: 'Error codes',
              autogenerate: { directory: 'reference/errors' },
            },
          ],
        },
      ],
    }),
  ],
});
