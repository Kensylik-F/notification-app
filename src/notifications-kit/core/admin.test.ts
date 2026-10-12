import { describe, expect, it } from 'vitest';

import {
  MAX_RECIPIENTS,
  PublishAnnouncementRequestSchema,
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
import type { MessageContent, PublishDraft, SendDraft } from './index';

const NOW = Date.parse('2026-10-12T09:00:00Z');
const FREEFORM = 'custom-message';

const freeform: MessageContent = {
  mode: 'freeform',
  subject: '  Плановые работы  ',
  bodyHtml: '<p>Сервис <b>недоступен</b> с 22:00.</p>',
  bodyText: 'Сервис недоступен с 22:00.',
};

function sendDraft(patch: Partial<SendDraft> = {}): SendDraft {
  return {
    content: freeform,
    channels: ['EMAIL', 'IN_APP'],
    category: ' onboarding ',
    categoryClass: 'TRANSACTIONAL',
    priority: 'NORMAL',
    recipients: [recipientFromInput('u-42')!, recipientFromInput('a@b.ru')!],
    scheduledAt: null,
    ...patch,
  };
}

describe('send', () => {
  it('sends free text through the free-form template', () => {
    expect(
      validateSend(sendDraft(), { freeformTemplateKey: FREEFORM, now: NOW })
    ).toEqual({});
    const request = buildSendRequest(sendDraft(), FREEFORM);
    expect(SendNotificationRequestSchema.parse(request)).toEqual(request);
    expect(request).toMatchObject({
      templateKey: FREEFORM,
      category: 'onboarding',
      variables: {
        subject: 'Плановые работы',
        bodyHtml: '<p>Сервис <b>недоступен</b> с 22:00.</p>',
        bodyText: 'Сервис недоступен с 22:00.',
      },
      recipients: [{ userId: 'u-42' }, { address: 'a@b.ru' }],
    });
    expect(request).not.toHaveProperty('scheduledAt');
  });

  it('refuses free text when the deployment has no free-form template', () => {
    expect(validateSend(sendDraft(), { now: NOW }).body).toBe('unavailable');
  });

  it('sends any template by key with its variables', () => {
    const content: MessageContent = {
      mode: 'template',
      templateKey: 'Order.Status',
      variables: [
        { name: 'orderId', value: ' 17 ' },
        { name: 'note', value: '' },
      ],
    };
    expect(validateSend(sendDraft({ content }), { now: NOW }).templateKey).toBe(
      'pattern'
    );
    const fixed = { ...content, templateKey: 'order.status' };
    expect(validateSend(sendDraft({ content: fixed }), { now: NOW })).toEqual(
      {}
    );
    expect(buildSendRequest(sendDraft({ content: fixed }))).toMatchObject({
      templateKey: 'order.status',
      variables: { orderId: '17' },
    });
    const twice = {
      ...fixed,
      variables: [
        { name: 'a', value: '1' },
        { name: 'a', value: '2' },
      ],
    };
    expect(
      validateSend(sendDraft({ content: twice }), { now: NOW }).variables
    ).toBe('duplicate');
  });

  it('reports what is wrong, by code', () => {
    const errors = validateSend(
      sendDraft({
        content: { ...freeform, subject: ' ', bodyText: '' },
        channels: [],
        category: '',
        recipients: [],
        scheduledAt: '2026-10-12T08:00',
      }),
      { freeformTemplateKey: FREEFORM, now: NOW }
    );
    expect(errors).toEqual({
      subject: 'required',
      body: 'required',
      channels: 'required',
      category: 'required',
      recipients: 'required',
      scheduledAt: 'past',
    });
    const many = Array.from(
      { length: MAX_RECIPIENTS + 1 },
      (_, i) => recipientFromInput(`u-${i}`)!
    );
    expect(
      validateSend(sendDraft({ recipients: many }), {
        freeformTemplateKey: FREEFORM,
        now: NOW,
      }).recipients
    ).toBe('tooMany');
  });
});

describe('publish', () => {
  const draft = (patch: Partial<PublishDraft> = {}): PublishDraft => ({
    category: 'platform-release',
    audienceType: 'EVERYONE',
    audienceValue: 'ignored',
    content: freeform,
    visibleFrom: null,
    visibleUntil: '2026-10-19T09:00:00Z',
    ...patch,
  });
  const opts = { freeformTemplateKey: FREEFORM, now: NOW };

  it('builds a request the contract accepts', () => {
    expect(validatePublish(draft(), opts)).toEqual({});
    const request = buildPublishRequest(draft(), FREEFORM);
    expect(PublishAnnouncementRequestSchema.parse(request)).toEqual(request);
    expect(request).not.toHaveProperty('audienceValue');
    expect(request).not.toHaveProperty('visibleFrom');
  });

  it('checks the audience and the window', () => {
    expect(
      validatePublish(draft({ audienceType: 'ROLE', audienceValue: ' ' }), opts)
        .audience
    ).toBe('required');
    expect(
      validatePublish(draft({ visibleUntil: '2026-10-12T08:00:00Z' }), opts)
        .visibleUntil
    ).toBe('beforeStart');
    expect(
      validatePublish(draft({ visibleUntil: '2027-02-01T00:00:00Z' }), opts)
        .visibleUntil
    ).toBe('tooLong');
    expect(
      validatePublish(draft({ visibleUntil: '2027-02-01T00:00:00Z' }), {
        ...opts,
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
