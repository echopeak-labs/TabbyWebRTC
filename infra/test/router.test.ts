import { getHandlerForMessageType } from '../lambda/src/router';

describe('router dispatch', () => {
  it('resolves AGENT_REGISTER handler', () => {
    expect(getHandlerForMessageType('AGENT_REGISTER')).toBeDefined();
  });

  it('resolves AGENT_HEARTBEAT handler', () => {
    expect(getHandlerForMessageType('AGENT_HEARTBEAT')).toBeDefined();
  });

  it('resolves SUBSCRIBE handler', () => {
    expect(getHandlerForMessageType('SUBSCRIBE')).toBeDefined();
  });

  it('resolves UNSUBSCRIBE handler', () => {
    expect(getHandlerForMessageType('UNSUBSCRIBE')).toBeDefined();
  });

  it('resolves SDP_OFFER handler', () => {
    expect(getHandlerForMessageType('SDP_OFFER')).toBeDefined();
  });

  it('resolves SDP_ANSWER handler', () => {
    expect(getHandlerForMessageType('SDP_ANSWER')).toBeDefined();
  });

  it('resolves ICE_CANDIDATE handler', () => {
    expect(getHandlerForMessageType('ICE_CANDIDATE')).toBeDefined();
  });

  it('returns undefined for unknown message types', () => {
    expect(getHandlerForMessageType('AUTH_APPROVE')).toBeUndefined();
    expect(getHandlerForMessageType('REFRESH_SESSION')).toBeUndefined();
    expect(getHandlerForMessageType('NOT_A_REAL_TYPE')).toBeUndefined();
  });
});
