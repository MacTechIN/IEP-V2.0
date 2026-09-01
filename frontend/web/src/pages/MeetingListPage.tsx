import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { Button } from '../components/Button';
import { apiClient } from '../services/api';

export const MeetingListPage: React.FC = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [editData, setEditData] = useState({ title: '', notes: '' });

  const loadMeetings = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.getMeetings({ limit: 50 });
      if (response.success) {
        setMeetings(response.data);
      }
    } catch (err) {
      console.error('Failed to load meetings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const handleOpenDialog = (meeting: any) => {
    setSelectedMeeting(meeting);
    setEditData({ title: meeting.title, notes: meeting.notes || '' });
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setSelectedMeeting(null);
  };

  const handleSave = async () => {
    try {
      await apiClient.updateMeeting(selectedMeeting.id, editData);
      await loadMeetings();
      handleCloseDialog();
    } catch (err) {
      console.error('Failed to update meeting:', err);
    }
  };

  const handleDelete = async (meetingId: string) => {
    if (window.confirm('이 조사를 삭제하시겠습니까?')) {
      try {
        await apiClient.deleteMeeting(meetingId);
        await loadMeetings();
      } catch (err) {
        console.error('Failed to delete meeting:', err);
      }
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">조사 목록</Typography>
        <Button variant="primary" onClick={() => navigate('/upload')}>
          새 조사 추가
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead sx={{ backgroundColor: '#F3F4F6' }}>
            <TableRow>
              <TableCell>조사명</TableCell>
              {/* **종류가 안 보이면 목록에서 법률 조사를 구분할 수 없다.**
                  2026-08-26 이전에는 목록 API 가 kind 를 안 줘서 전부 「일반」 이었다. */}
              <TableCell>종류</TableCell>
              <TableCell>대상자</TableCell>
              <TableCell>날짜</TableCell>
              <TableCell>상태</TableCell>
              <TableCell>점수</TableCell>
              <TableCell align="right">작업</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {meetings.map((meeting) => (
              <TableRow
                key={meeting.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/meetings/${meeting.id}`)}
              >
                <TableCell sx={{ fontWeight: 500, color: '#0066CC' }}>
                  {meeting.title}
                  {/* 비닉권 대상이면 목록에서도 보인다 (021) — 내보내기 전에 알아야 한다 */}
                  {meeting.privileged && (
                    <Chip size="small" label="비닉권" sx={{
                      ml: .75, height: 18, fontSize: '.66rem',
                      bgcolor: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5',
                    }} />
                  )}
                </TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined"
                    color={meeting.kind === 'interrogation' ? 'error'
                         : meeting.kind === 'victim' ? 'secondary'
                         : meeting.kind === 'witness' ? 'primary' : 'default'}
                    label={{ interrogation: '피의자 신문', witness: '참고인 조사', victim: '피해자 조사',
                             interview: '면담', meeting: '회의' }[meeting.kind as string] || '일반'} />
                </TableCell>
                <TableCell>{meeting.customerName || '-'}</TableCell>
                <TableCell>
                  {new Date(meeting.createdAt).toLocaleDateString('ko-KR')}
                </TableCell>
                <TableCell>
                  <Chip
                    label={
                      meeting.analysisStatus === 'completed' ? '완료' :
                      meeting.analysisStatus === 'processing' ? '진행중' : '대기'
                    }
                    color={
                      meeting.analysisStatus === 'completed' ? 'success' :
                      meeting.analysisStatus === 'processing' ? 'warning' : 'default'
                    }
                    variant="outlined"
                    size="small"
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#0066CC' }}>
                  {meeting.overallScore ?? '-'}
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => handleOpenDialog(meeting)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(meeting.id)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>조사 수정</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            fullWidth
            label="조사명"
            value={editData.title}
            onChange={(e) => setEditData({ ...editData, title: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="메모"
            multiline
            rows={4}
            value={editData.notes}
            onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="secondary" onClick={handleCloseDialog}>
            취소
          </Button>
          <Button variant="primary" onClick={handleSave}>
            저장
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default MeetingListPage;
