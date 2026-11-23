import { createWorkflow, randomCredentialPayload, testDb } from '@n8n/backend-test-utils';
import type { Person } from '@n8n/db';
import { CredentialsRepository, ExecutionRepository, WorkflowRepository } from '@n8n/db';
import { Container } from '@n8n/di';

import { saveCredential } from '../shared/db/credentials';
import { createExecution } from '../shared/db/executions';
import { cleanupRolesAndScopes } from '../shared/db/roles';
import { createMember } from '../shared/db/users';
import * as utils from '../shared/utils/';

// Cross-user isolation: user B changes resource IDs that belong to user A.
// Each request must fail, and A's data must not change.

const DENIED_STATUSES = [403, 404];

const testServer = utils.setupTestServer({
	endpointGroups: ['workflows', 'credentials', 'executions'],
});

let userA: Person;
let userB: Person;

beforeAll(async () => {
	await utils.initNodeTypes();
});

beforeEach(async () => {
	await testDb.truncate([
		'SharedWorkflow',
		'SharedCredentials',
		'ExecutionEntity',
		'ExecutionMetadata',
		'WorkflowEntity',
		'CredentialsEntity',
		'ProjectRelation',
		'Project',
		'User',
	]);
	await cleanupRolesAndScopes();

	userA = await createMember();
	userB = await createMember();
});

describe('workflows', () => {
	test('list returns only the caller own workflows', async () => {
		const ownWorkflow = await createWorkflow({ name: 'User A workflow' }, userA);
		await createWorkflow({ name: 'User B workflow' }, userB);

		const response = await testServer.authAgentFor(userA).get('/workflows').expect(200);

		const ids = response.body.data.map((workflow: { id: string }) => workflow.id);
		expect(ids).toEqual([ownWorkflow.id]);
	});

	test('fetching another user workflow by ID is denied', async () => {
		const workflowA = await createWorkflow({ name: 'Private A' }, userA);

		const response = await testServer.authAgentFor(userB).get(`/workflows/${workflowA.id}`);

		expect(DENIED_STATUSES).toContain(response.status);
		expect(response.body.data).toBeUndefined();
	});

	test('updating another user workflow is denied and leaves it unchanged', async () => {
		const workflowA = await createWorkflow({ name: 'Original name' }, userA);

		const response = await testServer
			.authAgentFor(userB)
			.patch(`/workflows/${workflowA.id}`)
			.send({ name: 'Changed by B', nodes: [], connections: {}, settings: {} });

		expect(DENIED_STATUSES).toContain(response.status);

		const stored = await Container.get(WorkflowRepository).findById(workflowA.id);
		expect(stored?.name).toBe('Original name');
	});

	test('deleting another user workflow is denied and keeps it', async () => {
		const workflowA = await createWorkflow({ name: 'Keep me' }, userA);

		const response = await testServer.authAgentFor(userB).delete(`/workflows/${workflowA.id}`);

		expect(DENIED_STATUSES).toContain(response.status);

		const stored = await Container.get(WorkflowRepository).findById(workflowA.id);
		expect(stored).not.toBeNull();
	});

	test('executing another user workflow is denied', async () => {
		const workflowA = await createWorkflow({ name: 'Run target' }, userA);

		const response = await testServer
			.authAgentFor(userB)
			.post(`/workflows/${workflowA.id}/run`)
			.send({});

		expect(DENIED_STATUSES).toContain(response.status);
	});

	test('sharing another user workflow with B is denied', async () => {
		const workflowA = await createWorkflow({ name: 'Not shared' }, userA);

		const response = await testServer
			.authAgentFor(userB)
			.put(`/workflows/${workflowA.id}/share`)
			.send({ shareWithIds: [userB.id] });

		expect(DENIED_STATUSES).toContain(response.status);
	});
});

describe('credentials', () => {
	test('fetching another user credential by ID is denied', async () => {
		const credentialA = await saveCredential(randomCredentialPayload(), {
			user: userA,
			role: 'credential:owner',
		});

		const response = await testServer.authAgentFor(userB).get(`/credentials/${credentialA.id}`);

		expect(DENIED_STATUSES).toContain(response.status);
		expect(JSON.stringify(response.body)).not.toContain(credentialA.name);
	});

	test('updating another user credential is denied and leaves it unchanged', async () => {
		const credentialA = await saveCredential(randomCredentialPayload(), {
			user: userA,
			role: 'credential:owner',
		});
		const originalName = credentialA.name;

		const response = await testServer
			.authAgentFor(userB)
			.patch(`/credentials/${credentialA.id}`)
			.send({ name: 'Hijacked', type: credentialA.type, data: {} });

		expect(DENIED_STATUSES).toContain(response.status);

		const stored = await Container.get(CredentialsRepository).findOneBy({ id: credentialA.id });
		expect(stored?.name).toBe(originalName);
	});

	test('deleting another user credential is denied and keeps it', async () => {
		const credentialA = await saveCredential(randomCredentialPayload(), {
			user: userA,
			role: 'credential:owner',
		});

		const response = await testServer.authAgentFor(userB).delete(`/credentials/${credentialA.id}`);

		expect(DENIED_STATUSES).toContain(response.status);

		const stored = await Container.get(CredentialsRepository).findOneBy({ id: credentialA.id });
		expect(stored).not.toBeNull();
	});
});

describe('executions', () => {
	test('reading another user execution details is denied', async () => {
		const workflowA = await createWorkflow({ name: 'Exec owner' }, userA);
		const executionA = await createExecution({ data: { resultData: { runData: {} } } }, workflowA);

		const response = await testServer.authAgentFor(userB).get(`/executions/${executionA.id}`);

		expect(DENIED_STATUSES).toContain(response.status);
		expect(response.body.data).toBeUndefined();
	});

	test('deleting another user execution is denied and keeps it', async () => {
		const workflowA = await createWorkflow({ name: 'Exec delete' }, userA);
		const executionA = await createExecution({}, workflowA);

		const response = await testServer
			.authAgentFor(userB)
			.post('/executions/delete')
			.send({ ids: [executionA.id] });

		// User B has no accessible workflows, so the controller returns not found.
		expect(DENIED_STATUSES).toContain(response.status);

		const stored = await Container.get(ExecutionRepository).findSingleExecution(executionA.id, {
			includeData: false,
		});
		expect(stored).not.toBeUndefined();
	});
});
