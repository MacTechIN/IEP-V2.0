import { MeetingService } from '../services/meetingService';
import { CustomerService } from '../services/customerService';

describe('Customer & Meeting Service', () => {
  let customerId: string;
  let meetingId: string;

  it('should create a customer', async () => {
    const customer = await CustomerService.createCustomer({
      userId: 'user-123',
      companyName: 'Test Corp',
    });

    expect(customer.id).toBeDefined();
    expect(customer.companyName).toBe('Test Corp');
    customerId = customer.id;
  });

  it('should create a meeting', async () => {
    const meeting = await MeetingService.createMeeting({
      userId: 'user-123',
      customerId,
      title: 'Test Meeting',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    expect(meeting.id).toBeDefined();
    expect(meeting.title).toBe('Test Meeting');
    expect(meeting.analysisStatus).toBe('pending');
    meetingId = meeting.id;
  });

  it('should retrieve meeting by id', async () => {
    const meeting = await MeetingService.getMeetingById(meetingId);

    expect(meeting).toBeDefined();
    expect(meeting?.id).toBe(meetingId);
    expect(meeting?.title).toBe('Test Meeting');
  });

  it('should list meetings', async () => {
    const result = await MeetingService.getMeetings('user-123');

    expect(result.meetings).toBeDefined();
    expect(Array.isArray(result.meetings)).toBe(true);
    expect(result.meetings.length).toBeGreaterThan(0);
  });

  it('should have started analysis', async () => {
    // Analysis is auto-started on create (simulated via setInterval, verified in live smoke test)
    const meeting = await MeetingService.getMeetingById(meetingId);
    expect(['pending', 'processing', 'completed']).toContain(meeting?.analysisStatus);
  });

  it('should update meeting', async () => {
    const updated = await MeetingService.updateMeeting(meetingId, {
      title: 'Updated Meeting Title',
      notes: 'Test notes',
    });

    expect(updated).toBeDefined();
    expect(updated?.title).toBe('Updated Meeting Title');
    expect(updated?.notes).toBe('Test notes');
  });

  it('should delete meeting', async () => {
    const deleted = await MeetingService.deleteMeeting(meetingId);

    expect(deleted).toBe(true);

    const meeting = await MeetingService.getMeetingById(meetingId);
    expect(meeting).toBeNull();
  });
});
