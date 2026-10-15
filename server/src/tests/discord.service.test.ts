jest.mock('@/config', () => ({
  BOT_TOKEN: 'test-bot-token',
}));

jest.mock('@/utils/logger', () => {
  const instance = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { createLogger: () => instance, logger: instance };
});

// Keep the real embed/component classes, but never log a bot in to Discord.
jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => ({ login: jest.fn(), once: jest.fn(), channels: { cache: new Map() } })),
  };
});

import { MessageActionRow } from 'discord.js';
import discordService from '@/services/discord.service';
import { createEntityHyperLink } from '@utils/blockParser';

const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const member = { id: 'member1', name: 'Ada', url: 'https://community.test/member/member1', createdAt: longAgo };
const admin = { id: 'admin1', name: 'Grace', url: 'https://community.test/member/admin1', createdAt: longAgo };
const space = { id: 'space1', name: 'General', url: 'https://community.test/general' };

const buildSentences = (payload: Record<string, unknown>) =>
  (discordService as any).sentenceBuilder({ network: { domain: 'community.test' }, ...payload }, new MessageActionRow());

describe('createEntityHyperLink', () => {
  it('links an entity with a name and url', () => {
    expect(createEntityHyperLink(member as any)).toBe('[Ada](https://community.test/member/member1)');
  });

  it('returns the plain name when there is no url', () => {
    expect(createEntityHyperLink({ name: 'Ada' } as any)).toBe('Ada');
  });

  it('returns an empty string instead of throwing for a missing entity', () => {
    expect(createEntityHyperLink(undefined)).toBe('');
    expect(createEntityHyperLink({} as any)).toBe('');
  });
});

describe('DiscordService.sentenceBuilder', () => {
  describe('space_membership.created', () => {
    it('posts "joined" when the event has no actor', () => {
      const { sentences, title } = buildSentences({ event: 'space_membership.created', member, space });

      expect(title).toBe('Ada joined General');
      expect(sentences).toEqual([
        '[Ada](https://community.test/member/member1) joined [General](https://community.test/general)',
      ]);
    });

    it('posts "joined" when the member added themselves', () => {
      const { title } = buildSentences({ event: 'space_membership.created', member, actor: member, space });

      expect(title).toBe('Ada joined General');
    });

    it('posts "added" when someone else added the member', () => {
      const { sentences, title } = buildSentences({ event: 'space_membership.created', member, actor: admin, space });

      expect(title).toBe('Grace added Ada to General');
      expect(sentences[0]).toContain('[Grace](https://community.test/member/admin1) added [Ada]');
    });

    it('still skips members created moments ago (default space joins on sign-up)', () => {
      const newMember = { ...member, createdAt: new Date().toISOString() };
      const { sentences } = buildSentences({ event: 'space_membership.created', member: newMember, space });

      expect(sentences).toEqual([]);
    });

    it('does not throw when the space could not be loaded', () => {
      expect(() => buildSentences({ event: 'space_membership.created', member })).not.toThrow();
    });
  });

  describe('space_membership.deleted', () => {
    it('posts "left" when the event has no actor', () => {
      const { title } = buildSentences({ event: 'space_membership.deleted', member, space });

      expect(title).toBe('Ada left General');
    });

    it('posts "removed" when someone else removed the member', () => {
      const { title } = buildSentences({ event: 'space_membership.deleted', member, actor: admin, space });

      expect(title).toBe('Grace removed Ada from General');
    });
  });

  it('does not throw for other events with a missing actor', () => {
    for (const event of ['space_join_request.accepted', 'member_invitation.created']) {
      expect(() => buildSentences({ event, member, space })).not.toThrow();
    }
  });
});
