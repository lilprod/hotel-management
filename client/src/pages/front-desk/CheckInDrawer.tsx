import { PrinterOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Radio,
  Result,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@hm/ui';

import { useCan } from '../../auth/useCan';
import { formatDayLong, get, nightsBetween, post } from '../../reservations/api';
import { useBusinessDate } from '../../reservations/refs';
import { fdKeys, openPoliceForm, useAvailableRooms } from './api';
import type { DayRow, Identity, StayResult } from './api';
import {
  DepositFields,
  IdentityFields,
  PoliceStayFields,
  UploadFields,
} from './PoliceFields';
import type { DepositValue, PoliceStay } from './PoliceFields';
import {
  emptyIdentity,
  hasErrors,
  parseGuestPath,
  prefillIdentity,
  roomSelectable,
  sortRooms,
  toGuestBody,
  validateIdentity,
} from './model';
import type { GuestProfile, IdentityErrors } from './model';
import { useFdError } from './useFdError';

const { Text } = Typography;

/** What the check-in needs to know about the reservation room being checked in. */
export interface CheckInTarget {
  propertyId: string;
  reservationId: string;
  reservationRoomId: string;
  number: string;
  guestId: string | null;
  guestName: string;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  roomNumber: string | null;
  hkStatus: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  currency: string;
}

export const targetFromRow = (r: DayRow, propertyId: string): CheckInTarget => ({
  propertyId,
  reservationId: r.reservationId,
  reservationRoomId: r.reservationRoomId,
  number: r.number,
  guestId: r.guest.id,
  guestName: r.guest.name,
  roomTypeId: r.roomTypeId,
  roomTypeName: r.roomTypeName,
  roomId: r.roomId,
  roomNumber: r.roomNumber,
  hkStatus: r.hkStatus,
  arrival: r.arrival,
  departure: r.departure,
  adults: r.adults,
  children: r.children,
  currency: r.currency,
});

const STEPS = ['reservation', 'room', 'identity', 'deposit', 'confirm'] as const;
type StepKey = (typeof STEPS)[number];

interface Props {
  target: CheckInTarget | null;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * Check-in wizard (OP-21): verify the reservation → room (only clean rooms suggested, dirty ones
 * flagged) → guest identity and police form (prefilled from the profile, ID scan optional) →
 * optional deposit → confirmation, then the printable police form.
 */
export function CheckInDrawer({ target, onClose, onDone }: Props) {
  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      width={860}
      destroyOnHidden
      title={target ? <CheckInTitle target={target} /> : null}
    >
      {target ? <CheckInBody key={target.reservationRoomId} target={target} onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function CheckInTitle({ target }: { target: CheckInTarget }) {
  const { t } = useTranslation('frontDesk');
  return <span>{t('checkin.title', { number: target.number })}</span>;
}

function CheckInBody({
  target,
  onClose,
  onDone,
}: {
  target: CheckInTarget;
  onClose: () => void;
  onDone?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation('frontDesk');
  const { can } = useCan();
  const qc = useQueryClient();
  const toMessage = useFdError();
  const bd = useBusinessDate(target.propertyId);
  const canOverride = can('front_desk.override_dirty');
  const canDeposit = can('folio.pay');

  const [step, setStep] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(target.roomId);
  const [anyType, setAnyType] = useState(false);
  const [override, setOverride] = useState(false);
  const [identities, setIdentities] = useState<Identity[]>([emptyIdentity()]);
  const [errors, setErrors] = useState<IdentityErrors[]>([{}]);
  const [police, setPolice] = useState<PoliceStay>({ provenance: '', destination: '', purpose: '' });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [withDeposit, setWithDeposit] = useState(false);
  const [deposit, setDeposit] = useState<DepositValue>({ method: 'CARD', amount: null, reference: '' });
  const [notify, setNotify] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<StayResult | null>(null);

  // Prefill from the guest profile (the stored document number stays masked server-side).
  const profile = useQuery({
    queryKey: ['guest', target.guestId],
    queryFn: () => get<GuestProfile>(`/guests/${target.guestId}`),
    enabled: !!target.guestId,
  });
  const prefilled = useRef(false);
  useEffect(() => {
    if (profile.data && !prefilled.current) {
      prefilled.current = true;
      setIdentities((cur) => [{ ...prefillIdentity(profile.data), ...Object.fromEntries(Object.entries(cur[0] ?? {}).filter(([, v]) => v)) } as Identity, ...cur.slice(1)]);
    }
  }, [profile.data]);
  const storedNumber = profile.data?.idDocNumberMasked ?? null;

  const from = bd.data && bd.data > target.arrival ? bd.data : target.arrival;
  const rooms = useAvailableRooms({
    propertyId: target.propertyId,
    from,
    to: target.departure,
    roomTypeId: anyType ? undefined : target.roomTypeId,
    reservationRoomId: target.reservationRoomId,
    enabled: step >= 1,
  });
  const sorted = useMemo(() => sortRooms(rooms.data ?? [], target.roomId), [rooms.data, target.roomId]);
  const chosen = sorted.find((r) => r.id === roomId) ?? null;
  const chosenType = chosen?.roomTypeId ?? target.roomTypeId;
  const roomOk = !!chosen && roomSelectable(chosen, canOverride) && (chosen.clean || override);

  const checkIn = useMutation({
    mutationFn: () =>
      post<StayResult>('/front-desk/stays', {
        reservationRoomId: target.reservationRoomId,
        ...(roomId && roomId !== target.roomId ? { roomId } : {}),
        changeRoomType: chosenType !== target.roomTypeId,
        guests: identities.map(toGuestBody),
        police: {
          provenance: police.provenance || undefined,
          destination: police.destination || undefined,
          purpose: police.purpose || undefined,
          ...(Object.keys(custom).length ? { customFields: custom } : {}),
        },
        ...(signatureId ? { signatureFileId: signatureId } : {}),
        ...(scanId ? { idScanFileId: scanId } : {}),
        ...(withDeposit && deposit.amount
          ? {
              deposit: {
                method: deposit.method,
                amount: deposit.amount,
                ...(deposit.reference ? { reference: deposit.reference } : {}),
              },
            }
          : {}),
        overrideDirty: !!chosen && !chosen.clean && override,
        notifyGuest: notify,
      }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: fdKeys.all });
      void qc.invalidateQueries({ queryKey: ['reservations'] });
      void qc.invalidateQueries({ queryKey: ['planning'] });
      void qc.invalidateQueries({ queryKey: ['reservation', target.reservationId] });
      onDone?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && e.errors.length) {
        const next = identities.map(() => ({}) as IdentityErrors);
        for (const issue of e.errors) {
          const p = parseGuestPath(issue.path ?? '');
          if (p && next[p[0]]) next[p[0]]![p[1]] = 'validation.required';
        }
        setErrors(next);
        setStep(2);
      }
      setFailure(toMessage(e));
    },
  });

  const validateIdentities = () => {
    const next = identities.map((id, i) =>
      validateIdentity(id, { storedNumber: i === 0 && !!storedNumber }),
    );
    setErrors(next);
    return !next.some(hasErrors);
  };

  const next = () => {
    setFailure(null);
    if (STEPS[step] === 'identity' && !validateIdentities()) return;
    setStep(step + 1);
  };

  if (result)
    return (
      <Result
        status={result.deposit && !result.deposit.ok ? 'warning' : 'success'}
        title={t('checkin.done', { room: result.roomNumber })}
        subTitle={
          <Space direction="vertical" size={2}>
            <Text>{t('checkin.policeCreated', { count: result.policeRecordIds.length })}</Text>
            {result.deposit ? (
              <Text type={result.deposit.ok ? undefined : 'danger'}>
                {result.deposit.ok ? t('checkin.depositOk') : t('checkin.depositFailed', { error: result.deposit.error })}
              </Text>
            ) : null}
            {result.warnings.map((w) => (
              <Text key={w} type="warning">
                {w}
              </Text>
            ))}
          </Space>
        }
        extra={[
          can('front_desk.police_form') ? (
            <Button
              key="print"
              icon={<PrinterOutlined />}
              onClick={() => void openPoliceForm(result.stayId)}
            >
              {t('checkin.printPolice')}
            </Button>
          ) : null,
          <Button key="close" type="primary" onClick={onClose}>
            {t('close')}
          </Button>,
        ]}
      />
    );

  const key: StepKey = STEPS[step]!;
  return (
    <Flex vertical gap={16}>
      <Steps
        size="small"
        current={step}
        items={STEPS.map((s) => ({ title: t(`checkin.steps.${s}`) }))}
        responsive
      />
      {failure ? <Alert type="error" showIcon message={failure} role="alert" /> : null}

      {key === 'reservation' ? (
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label={t('fields.reservation')}>{target.number}</Descriptions.Item>
          <Descriptions.Item label={t('fields.guest')}>{target.guestName}</Descriptions.Item>
          <Descriptions.Item label={t('fields.stay')}>
            {formatDayLong(target.arrival, i18n.language)} → {formatDayLong(target.departure, i18n.language)} (
            {t('nights', { count: nightsBetween(target.arrival, target.departure) })})
          </Descriptions.Item>
          <Descriptions.Item label={t('fields.persons')}>
            {t('persons', { adults: target.adults, children: target.children })}
          </Descriptions.Item>
          <Descriptions.Item label={t('fields.roomType')}>{target.roomTypeName}</Descriptions.Item>
          <Descriptions.Item label={t('fields.room')}>
            {target.roomNumber ?? t('unassigned')}
          </Descriptions.Item>
        </Descriptions>
      ) : null}

      {key === 'room' ? (
        <Flex vertical gap={12}>
          {rooms.isLoading ? <Skeleton active /> : null}
          <Radio.Group
            value={roomId}
            onChange={(e) => setRoomId(e.target.value as string)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            aria-label={t('checkin.chooseRoom')}
          >
            {sorted.map((r) => (
              <Radio key={r.id} value={r.id} disabled={!roomSelectable(r, canOverride)}>
                <Space>
                  <strong>{r.number}</strong>
                  <span>{r.roomTypeName}</span>
                  {r.clean ? (
                    <Tag color="success">{t(`hk.${r.hkStatus}`)}</Tag>
                  ) : (
                    <Tag color="warning">{t('checkin.dirty', { status: t(`hk.${r.hkStatus}`) })}</Tag>
                  )}
                  {r.id === target.roomId ? <Tag>{t('checkin.assigned')}</Tag> : null}
                </Space>
              </Radio>
            ))}
          </Radio.Group>
          {!rooms.isLoading && !sorted.length ? (
            <Alert type="warning" showIcon message={t('checkin.noRoom')} />
          ) : null}
          <Checkbox checked={anyType} onChange={(e) => setAnyType(e.target.checked)}>
            {t('checkin.otherTypes')}
          </Checkbox>
          {chosen && !chosen.clean ? (
            canOverride ? (
              <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>
                {t('checkin.overrideDirty')}
              </Checkbox>
            ) : (
              <Alert type="warning" showIcon message={t('checkin.dirtyForbidden')} />
            )
          ) : null}
        </Flex>
      ) : null}

      {key === 'identity' ? (
        <Form layout="vertical" component="div">
          {profile.isLoading ? <Skeleton active /> : null}
          {identities.map((id, i) => (
            <Flex vertical key={i} style={{ marginBottom: 12 }}>
              <Text strong>{i === 0 ? t('checkin.mainGuest') : t('checkin.companion', { n: i })}</Text>
              <IdentityFields
                id={`id-${i}`}
                value={id}
                errors={errors[i] ?? {}}
                storedNumber={i === 0 ? storedNumber : null}
                onChange={(v) => setIdentities(identities.map((x, j) => (j === i ? v : x)))}
              />
              {i > 0 ? (
                <Button
                  type="link"
                  danger
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    setIdentities(identities.filter((_, j) => j !== i));
                    setErrors(errors.filter((_, j) => j !== i));
                  }}
                >
                  {t('checkin.removeCompanion')}
                </Button>
              ) : null}
            </Flex>
          ))}
          {identities.length < Math.min(10, target.adults + target.children) ? (
            <Button
              onClick={() => {
                setIdentities([...identities, emptyIdentity()]);
                setErrors([...errors, {}]);
              }}
            >
              {t('checkin.addCompanion')}
            </Button>
          ) : null}
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            {t('checkin.stayInfo')}
          </Typography.Title>
          <PoliceStayFields value={police} onChange={setPolice} custom={custom} onCustomChange={setCustom} />
          <UploadFields
            signatureId={signatureId}
            scanId={scanId}
            onSignature={setSignatureId}
            onScan={setScanId}
          />
        </Form>
      ) : null}

      {key === 'deposit' ? (
        <Form layout="vertical" component="div">
          {canDeposit ? (
            <>
              <Checkbox checked={withDeposit} onChange={(e) => setWithDeposit(e.target.checked)}>
                {t('checkin.takeDeposit')}
              </Checkbox>
              {withDeposit ? (
                <div style={{ marginTop: 12 }}>
                  <DepositFields value={deposit} onChange={setDeposit} currency={target.currency} />
                </div>
              ) : null}
            </>
          ) : (
            <Alert type="info" showIcon message={t('checkin.noDepositPermission')} />
          )}
        </Form>
      ) : null}

      {key === 'confirm' ? (
        <Flex vertical gap={12}>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t('fields.reservation')}>{target.number}</Descriptions.Item>
            <Descriptions.Item label={t('fields.room')}>
              {chosen?.number ?? target.roomNumber}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.guest')}>
              {identities.map((i) => `${i.lastName.toUpperCase()} ${i.firstName}`).join(', ')}
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.stay')}>
              {formatDayLong(target.arrival, i18n.language)} → {formatDayLong(target.departure, i18n.language)}
            </Descriptions.Item>
            {withDeposit && deposit.amount ? (
              <Descriptions.Item label={t('deposit.amount')}>
                {deposit.amount} {target.currency} ({t(`methods.${deposit.method}`)})
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          {chosen && !chosen.clean ? (
            <Alert type="warning" showIcon message={t('checkin.overrideNotice')} />
          ) : null}
          <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)}>
            {t('checkin.sendWelcome')}
          </Checkbox>
        </Flex>
      ) : null}

      <Flex justify="space-between" gap={8}>
        <Button disabled={step === 0 || checkIn.isPending} onClick={() => setStep(step - 1)}>
          {t('back')}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="primary" disabled={key === 'room' && !roomOk} onClick={next}>
            {t('next')}
          </Button>
        ) : (
          <Button
            type="primary"
            loading={checkIn.isPending}
            disabled={!roomOk}
            onClick={() => {
              setFailure(null);
              checkIn.mutate();
            }}
          >
            {t('checkin.confirm')}
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
