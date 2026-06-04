import { prisma } from '../../lib/prisma.js';

/**
 * Platform branding + public site content, stored in `system_settings` (key
 * `branding`) so an admin can change the app/website name, links, and copy from
 * the CRM at any time — no code change or redeploy needed.
 */
export interface Branding {
  appName: string;
  tagline: string;
  heroSubtitle: string;
  logoUrl: string;       // image URL or base64 data-URL (uploaded from the CRM)
  webUrl: string;
  appUrl: string;        // mobile app / PWA link (future)
  supportEmail: string;
  feedbackEmail: string;
}

export const DEFAULT_BRANDING: Branding = {
  appName: 'DS2AuraTrading AI',
  tagline: 'Automated crypto trading on your own Binance account',
  heroSubtitle: 'Connect your Binance Futures account, pick a risk mode, and let an AI-scored bot trade for you — fully isolated, fully yours.',
  logoUrl: '',
  webUrl: 'https://yourplatform.com',
  appUrl: '',
  supportEmail: 'support@yourplatform.com',
  feedbackEmail: 'feedback@yourplatform.com',
};

const KEY = 'branding';

export const settingsService = {
  async getBranding(): Promise<Branding> {
    const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
    return { ...DEFAULT_BRANDING, ...((row?.value as Partial<Branding>) ?? {}) };
  },

  async updateBranding(patch: Partial<Branding>, adminId: string): Promise<Branding> {
    const current = await this.getBranding();
    const next = { ...current, ...patch };
    await prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next, updatedBy: adminId },
      update: { value: next, updatedBy: adminId },
    });
    return next;
  },

  /** Public landing-page feedback. Stored as an audit-log event (no extra table). */
  async submitFeedback(input: { name: string; email: string; message: string }, ip?: string) {
    await prisma.auditLog.create({
      data: { action: 'FEEDBACK', ip, metadata: { ...input } },
    });
  },
};
