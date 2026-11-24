import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Checkbox, Form, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../auth/useCan';
import { addDays, formatDayLong, nightsBetween, post } from '../../reservations/api';
import { useBusinessDate } from '../../reservations/refs';
import { fdKeys, useAvailableRooms } from './api';
import type { DayRow } from './api';
import { sortRooms } from './model';
import { useFdError } from './useFdError';

interface DialogProps {
  row: DayRow | null;
  propertyId: string;
  onClose: () => void;
  onDone?: () => void;
}

function useAfter(onDone?: () => void) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: fdKeys.all });
    void qc.invalidateQueries({ queryKey: ['planning'] });
    void qc.invalidateQueries({ queryKey: ['reservations'] });
    onDone?.();
  };
}

/** Room change during the stay (OP-22): remaining nights move, the old room becomes dirty. */
export function RoomChangeDialog({ row, propertyId, onClose, onDone }: DialogProps) {
  const { t } = useTranslation('frontDesk');
  const { can } = useCan();
  const { message } = AntApp.useApp();
  const toMessage = useFdError();
  const after = useAfter(onDone);
  const bd = useBusinessDate(propertyId);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [anyType, setAnyType] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setRoomId(null);
    setReason('');
    setOverride(false);
    setFailure(null);
  }, [row?.reservationRoomId]);

  const from = bd.data && row && bd.data > row.arrival ? bd.data : (row?.arrival ?? '');
  const rooms = useAvailableRooms({
    propertyId,
    from,
    to: row?.departure ?? '',
    roomTypeId: anyType ? undefined : row?.roomTypeId,
    reservationRoomId: row?.reservationRoomId,
    enabled: !!row,
  });
  const options = useMemo(
    () => sortRooms((rooms.data ?? []).filter((r) => r.id !== row?.roomId), null),
    [rooms.data, row?.roomId],
  );
  const chosen = options.find((r) => r.id === roomId) ?? null;
  const canOverride = can('front_desk.override_dirty');

  const move = useMutation({
    mutationFn: () =>
      post(`/front-desk/stays/${row!.reservationRoomId}/room-change`, {
        roomId,
        reason: reason.trim(),
        changeRoomType: !!chosen && chosen.roomTypeId !== row!.roomTypeId,
        overrideDirty: !!chosen && !chosen.clean && override,
      }),
    onSuccess: () => {
      void message.success(t('roomChange.done'));
      after();
      onClose();
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  const valid = !!chosen && reason.trim().length >= 3 && (chosen.clean || (override && canOverride));
  return (
    <Modal
      open={!!row}
      onCancel={onClose}
      destroyOnHidden
      title={t('roomChange.title', { room: row?.roomNumber ?? '' })}
      okText={t('roomChange.confirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !valid, loading: move.isPending }}
      onOk={() => {
        setFailure(null);
        move.mutate();
      }}
    >
      <Form layout="vertical" component="div">
        {failure ? <Alert type="error" showIcon message={failure} role="alert" style={{ marginBottom: 12 }} /> : null}
        <Form.Item label={t('roomChange.newRoom')}>
          <Select
            aria-label={t('roomChange.newRoom')}
            loading={rooms.isLoading}
            value={roomId ?? undefined}
            onChange={setRoomId}
            options={options.map((r) => ({
              value: r.id,
              disabled: !r.clean && !canOverride,
              label: (
                <Space>
                  <strong>{r.number}</strong>
                  {r.roomTypeName}
                  <Tag color={r.clean ? 'success' : 'warning'}>{t(`hk.${r.hkStatus}`)}</Tag>
                </Space>
              ),
            }))}
          />
          <Checkbox checked={anyType} onChange={(e) => setAnyType(e.target.checked)} style={{ marginTop: 8 }}>
            {t('checkin.otherTypes')}
          </Checkbox>
        </Form.Item>
        {chosen && !chosen.clean && canOverride ? (
          <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>
            {t('checkin.overrideDirty')}
          </Checkbox>
        ) : null}
        <Form.Item label={t('roomChange.reason')} required>
          <Input.TextArea
            aria-label={t('roomChange.reason')}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Form.Item>
        <Alert type="info" showIcon message={t('roomChange.info')} />
      </Form>
    </Modal>
  );
}

type DatesMode = 'extend' | 'shorten' | 'early';

/** Extend / shorten the stay (re-quoted, availability checked) or early departure. */
export function StayDatesDialog({ row, propertyId, onClose, onDone }: DialogProps) {
  const { t, i18n } = useTranslation('frontDesk');
  const { message } = AntApp.useApp();
  const toMessage = useFdError();
  const after = useAfter(onDone);
  const bd = useBusinessDate(propertyId);
  const [mode, setMode] = useState<DatesMode>('extend');
  const [departure, setDeparture] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (row) {
      setMode('extend');
      setDeparture(addDays(row.departure, 1));
      setFailure(null);
    }
  }, [row?.reservationRoomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const earliest = row ? addDays(row.arrival, 1) : '';
  const earlyDate = bd.data && bd.data > earliest ? bd.data : earliest;
  const target = mode === 'early' ? earlyDate : departure;
  const valid =
    !!row &&
    !!target &&
    (mode === 'extend' ? target > row.departure : target < row.departure && target >= earliest);

  const run = useMutation({
    mutationFn: () =>
      post(
        `/front-desk/stays/${row!.reservationRoomId}/${mode === 'early' ? 'early-departure' : mode}`,
        mode === 'early' ? {} : { departure: target },
      ),
    onSuccess: () => {
      void message.success(t('dates.done'));
      after();
      onClose();
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  return (
    <Modal
      open={!!row}
      onCancel={onClose}
      destroyOnHidden
      title={t('dates.title')}
      okText={t('dates.confirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !valid, loading: run.isPending }}
      onOk={() => {
        setFailure(null);
        run.mutate();
      }}
    >
      <Form layout="vertical" component="div">
        {failure ? <Alert type="error" showIcon message={failure} role="alert" style={{ marginBottom: 12 }} /> : null}
        <Radio.Group
          value={mode}
          onChange={(e) => {
            const m = e.target.value as DatesMode;
            setMode(m);
            if (row) setDeparture(m === 'extend' ? addDays(row.departure, 1) : row.departure);
          }}
          options={[
            { value: 'extend', label: t('dates.extend') },
            { value: 'shorten', label: t('dates.shorten') },
            { value: 'early', label: t('dates.early') },
          ]}
          style={{ marginBottom: 12 }}
        />
        {row ? (
          <p>
            {t('dates.current', { date: formatDayLong(row.departure, i18n.language) })}
          </p>
        ) : null}
        {mode !== 'early' ? (
          <Form.Item label={t('dates.newDeparture')}>
            <Input
              type="date"
              aria-label={t('dates.newDeparture')}
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </Form.Item>
        ) : (
          <Alert type="info" showIcon message={t('dates.earlyInfo', { date: formatDayLong(earlyDate, i18n.language) })} />
        )}
        {row && valid ? (
          <p>
            {t('dates.nights', { count: nightsBetween(row.arrival, target) })}
          </p>
        ) : null}
      </Form>
    </Modal>
  );
}
