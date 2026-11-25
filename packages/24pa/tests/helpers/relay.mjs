// dsh 0.2.3-alpha.1 and later record a subagent's first task as an agent
// message relayed from the parent session, behind a sender text block; hosts
// through 0.2.2-rc.5 recorded a user message.

/** The `source` of such a relay. */
export const relaySource = senderSessionId => ({ kind: 'agent-message', form: 'relay', senderSessionId });

/** A complete relayed input: the sender block ahead of the task content. */
export const relayMessage = (senderSessionId, content, id = 'relayed') => ({ id, content: [{ type: 'text', text: `Agent ${senderSessionId} sent a message: ` }, ...content], source: relaySource(senderSessionId) });
