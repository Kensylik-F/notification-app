import { describe, expect, it } from 'vitest';

import {
  MAX_RECIPIENTS,
  PublishAnnouncementRequestSchema,
  SERVICE_TEMPLATES,
  SendNotificationRequestSchema,
  buildPublishRequest,
  buildSendRequest,
  canCancelDelivery,
  canRetryDelivery,
  deliveryFilter,
  isTerminal,
  progressRatio,
  recipientFromInput,
  validatePublish,
  validateSend,
} from './index';
import type { PublishDraft, SendDraft } from './index';

const NOW = Date.parse('2026-10-12T09:00:00Z');
const welcome = SERVICE_TEMPLATES.find(t => t.key === 'welcome')!;
const release = SERVICE_TEMPLATES.find(t => t.key === 'platform-release')!;

function sendDraft(patch: Partial<SendDraft> = {}): SendDraft {
  return {
    template: welcome,
    customTemplateKey: '',
    variables: { productName: 'Sber Data', gettingStartedLink: '  ' },
    customVariables: [],
    channels: ['EMAIL', 'IN_APP'],
    category: ' onboarding ',
    categoryClass: 'TRANSACTIONAL',
    priority: 'NORMAL',
    recipients: [recipientFromInput('u-42')!, recipientFromInput('a@b.ru')!],
    scheduledAt: null,
    ...patch,
  };
}

describe('catalogue', () => {
  it('knows which templates fit an announcement', () => {
    expect(release.announcement).toBe(true);
    expect(welcome.announcement).toBe(false);
    expect(SERVICE_TEMPLATES.filter(t => t.digest).map(t => t.key)).toEqual([
      'activity-digest',
    ]);
    expect(welcome.variables).toEqual([
      { name: 'productName', required: true },
      { name: 'gettingStartedLink', required: false },
    ]);
  });
});

describe('send', () => {
  it('builds a request the contract accepts', () => {
    expect(validateSend(sendDraft(), NOW)).toEqual({});
    const request = buildSendRequest(sendDraft());
    expect(SendNotificationRequestSchema.parse(request)).toEqual(request);
    expect(request).toMatchObject({
      templateKey: 'welcome',
      category: 'onboarding',
      // Blank optional values are left out rather than sent empty.
      variables: { productName: 'Sber Data' },
      recipients: [{ userId: 'u-42' }, { address: 'a@b.ru' }],
    });
    expect(request).not.toHaveProperty('scheduledAt');
  });

  it('reports what is wrong, by code', () => {
    const errors = validateSend(
      sendDraft({
        variables: {},
        channels: [],
        category: '',
        recipients: [],
        scheduledAt: '2026-10-12T08:00',
      }),
      NOW
    );
    expect(errors).toEqual({
      variables: 'required',
      channels: 'required',
      category: 'required',
      recipients: 'required',
      scheduledAt: 'past',
    });
    const many = Array.from(
      { length: MAX_RECIPIENTS + 1 },
      (_, i) => recipientFromInput(`u-${i}`)!
    );
    expect(validateSend(sendDraft({ recipients: many }), NOW).recipients).toBe(
      'tooMany'
    );
  });

  it('accepts a hand-typed key and its variables', () => {
    const draft = sendDraft({
      template: null,
      customTemplateKey: 'Order.Status',
      customVariables: [{ name: 'orderId', value: '17' }],
    });
    expect(validateSend(draft, NOW).template).toBe('pattern');
    const fixed = { ...draft, customTemplateKey: 'order.status' };
    expect(validateSend(fixed, NOW)).toEqual({});
    expect(buildSendRequest(fixed).variables).toEqual({
      orderId: '17',
      productName: 'Sber Data',
    });
  });
});

describe('publish', () => {
  const draft = (patch: Partial<PublishDraft> = {}): PublishDraft => ({
    category: 'platform-release',
    audienceType: 'EVERYONE',
    audienceValue: 'ignored',
    template: release,
    customTemplateKey: '',
    variables: { productName: 'Sber Data', version: '2.4' },
    customVariables: [],
    visibleFrom: null,
    visibleUntil: '2026-10-19T09:00:00Z',
    ...patch,
  });

  it('builds a request the contract accepts', () => {
    expect(validatePublish(draft(), { now: NOW })).toEqual({});
    const request = buildPublishRequest(draft());
    expect(PublishAnnouncementRequestSchema.parse(request)).toEqual(request);
    expect(request).not.toHaveProperty('audienceValue');
    expect(request).not.toHaveProperty('visibleFrom');
  });

  it('checks the audience and the window', () => {
    expect(
      validatePublish(draft({ audienceType: 'ROLE', audienceValue: ' ' }), {
        now: NOW,
      }).audience
    ).toBe('required');
    expect(
      validatePublish(draft({ visibleUntil: '2026-10-12T08:00:00Z' }), {
        now: NOW,
      }).visibleUntil
    ).toBe('beforeStart');
    expect(
      validatePublish(draft({ visibleUntil: '2027-02-01T00:00:00Z' }), {
        now: NOW,
      }).visibleUntil
    ).toBe('tooLong');
    expect(
      validatePublish(draft({ visibleUntil: '2027-02-01T00:00:00Z' }), {
        now: NOW,
        maxVisibilityDays: 180,
      })
    ).toEqual({});
  });
});

describe('operations and deliveries', () => {
  it('reads the operation envelope', () => {
    expect(isTerminal({ status: 'RUNNING' })).toBe(false);
    expect(isTerminal({ status: 'CANCELLED' })).toBe(true);
    expect(isTerminal({ status: 'RUNNING', terminal: true })).toBe(true);
    expect(progressRatio({ progress: { completed: 5, total: null } })).toBe(
      null
    );
    expect(progressRatio({ progress: { completed: 5, total: 20 } })).toBe(0.25);
  });

  it('offers only the commands the service accepts', () => {
    expect(canRetryDelivery('DEAD')).toBe(true);
    expect(canRetryDelivery('FAILED')).toBe(false);
    expect(canCancelDelivery('PENDING')).toBe(true);
    expect(canCancelDelivery('SENT')).toBe(false);
  });

  it('turns filters into OData', () => {
    expect(
      deliveryFilter({
        statuses: ['DEAD', 'FAILED'],
        channel: 'EMAIL',
        requestId: '7c3f1c2e-8a54-4d0b-9f0e-3b1d2a4c5e6f',
      })
    ).toBe(
      "(status in ('DEAD', 'FAILED')) and (channel eq 'EMAIL') and (requestId eq 7c3f1c2e-8a54-4d0b-9f0e-3b1d2a4c5e6f)"
    );
    expect(deliveryFilter({})).toBeUndefined();
  });
});
