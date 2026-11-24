import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Result,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@hm/ui';

import { useCan } from '../../auth/useCan';
import { addDays, get, post, qs } from '../../reservations/api';
import type { Guest, Page } from '../../reservations/api';
import { useBusinessDate, useRatePlans, useRoomTypes } from '../../reservations/refs';
import { fdKeys, openPoliceForm, useAvailableRooms } from './api';
import type { Identity, StayResult } from './api';
import { DepositFields, IdentityFields, PoliceStayFields, UploadFields } from './PoliceFields';
import type { DepositValue, PoliceStay } from './PoliceFields';
import {
  emptyIdentity,
  hasErrors,
  parseGuestPath,
  prefillIdentity,
  toGuestBody,
  validateIdentity,
} from './model';
import type { GuestProfile, IdentityErrors } from './model';
import { useFdError } from './useFdError';

const { Text } = Typography;

interface Props {
  open: boolean;
  propertyId: string | null;
  currency?: string;
  onClose: () => void;
  onDone?: () => void;
}

/** Walk-in (OP-22): guest + reservation (today → departure) + check-in in a single call. */
export function WalkInDrawer({ open, propertyId, currency = 'XOF', onClose, onDone }: Props) {
  const { t } = useTranslation('frontDesk');
  return (
    <Drawer open={open} onClose={onClose} width={860} destroyOnHidden title={t('walkin.title')}>
      {open && propertyId ? (
        <WalkInBody propertyId={propertyId} currency={currency} onClose={onClose} onDone={onDone} />
      ) : null}
    </Drawer>
  );
}

function WalkInBody({
  propertyId,
  currency,
  onClose,
  onDone,
}: {
  propertyId: string;
  currency: string;
  onClose: () => void;
  onDone?: (() => void) | undefined;
}) {
  const { t } = useTranslation('frontDesk');
  const { can } = useCan();
  const qc = useQueryClient();
  const toMessage = useFdError();
  const bd = useBusinessDate(propertyId);
  const today = bd.data ?? '';
  const types = useRoomTypes(propertyId);
  const plans = useRatePlans(propertyId);

  const [departure, setDeparture] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [roomTypeId, setRoomTypeId] = useState<string>();
  const [ratePlanId, setRatePlanId] = useState<string>();
  const [roomId, setRoomId] = useState<string>();
  const [guestId, setGuestId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [identity, setIdentity] = useState<Identity>(emptyIdentity());
  const [errors, setErrors] = useState<IdentityErrors>({});
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [police, setPolice] = useState<PoliceStay>({ provenance: '', destination: '', purpose: '' });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [signatureId, setSignatureId] = useState<string | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [withDeposit, setWithDeposit] = useState(false);
  const [deposit, setDeposit] = useState<DepositValue>({ method: 'CARD', amount: null, reference: '' });
  const [override, setOverride] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<StayResult | null>(null);

  useEffect(() => {
    if (today && !departure) setDeparture(addDays(today, 1));
  }, [today, departure]);

  const found = useQuery({
    queryKey: ['guests-search', search],
    queryFn: async () => (await get<Page<Guest>>(`/guests${qs({ search, limit: 8 })}`)).items,
    enabled: search.trim().length >= 2,
  });
  const profile = useQuery({
    queryKey: ['guest', guestId],
    queryFn: () => get<GuestProfile>(`/guests/${guestId}`),
    enabled: !!guestId,
  });
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (profile.data && loaded.current !== profile.data.id) {
      loaded.current = profile.data.id;
      setIdentity(prefillIdentity(profile.data));
    }
  }, [profile.data]);
  const storedNumber = guestId ? (profile.data?.idDocNumberMasked ?? null) : null;

  const rooms = useAvailableRooms({
    propertyId,
    from: today,
    to: departure,
    roomTypeId,
    enabled: !!roomTypeId && !!today && !!departure && departure > today,
  });
  const clean = (rooms.data ?? []).filter((r) => r.clean || can('front_desk.override_dirty'));
  const chosen = rooms.data?.find((r) => r.id === roomId);

  const submit = useMutation({
    mutationFn: () =>
      post<StayResult>('/front-desk/walk-ins', {
        propertyId,
        departure,
        roomTypeId,
        ratePlanId,
        ...(roomId ? { roomId } : {}),
        adults,
        children,
        guest: guestId
          ? { id: guestId }
          : {
              firstName: identity.firstName.trim(),
              lastName: identity.lastName.trim(),
              ...(phone ? { phone } : {}),
              ...(email ? { email } : {}),
            },
        guests: [toGuestBody(identity)],
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
        notifyGuest: true,
      }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: fdKeys.all });
      void qc.invalidateQueries({ queryKey: ['planning'] });
      void qc.invalidateQueries({ queryKey: ['reservations'] });
      onDone?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        const next: IdentityErrors = {};
        for (const issue of e.errors) {
          const p = parseGuestPath(issue.path ?? '');
          if (p && p[0] === 0) next[p[1]] = 'validation.required';
        }
        setErrors(next);
      }
      setFailure(toMessage(e));
    },
  });

  const valid = !!roomTypeId && !!ratePlanId && !!departure && departure > today && adults >= 1;
  const submitNow = () => {
    const e = validateIdentity(identity, { storedNumber: !!storedNumber });
    setErrors(e);
    if (hasErrors(e)) {
      setFailure(t('walkin.incomplete'));
      return;
    }
    setFailure(null);
    submit.mutate();
  };

  if (result)
    return (
      <Result
        status="success"
        title={t('checkin.done', { room: result.roomNumber })}
        subTitle={t('checkin.policeCreated', { count: result.policeRecordIds.length })}
        extra={[
          can('front_desk.police_form') ? (
            <Button key="p" onClick={() => void openPoliceForm(result.stayId)}>
              {t('checkin.printPolice')}
            </Button>
          ) : null,
          <Button key="c" type="primary" onClick={onClose}>
            {t('close')}
          </Button>,
        ]}
      />
    );

  return (
    <Form layout="vertical" component="div">
      {failure ? <Alert type="error" showIcon message={failure} role="alert" style={{ marginBottom: 12 }} /> : null}
      <Divider orientation="left" plain>
        {t('walkin.stay')}
      </Divider>
      <Flex gap="0 12px" wrap>
        <Form.Item label={t('walkin.departure')} style={{ flex: '1 1 180px' }}>
          <Input
            type="date"
            aria-label={t('walkin.departure')}
            min={today ? addDays(today, 1) : undefined}
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t('walkin.adults')} style={{ flex: '0 1 120px' }}>
          <InputNumber aria-label={t('walkin.adults')} min={1} max={20} value={adults} onChange={(v) => setAdults(v ?? 1)} />
        </Form.Item>
        <Form.Item label={t('walkin.children')} style={{ flex: '0 1 120px' }}>
          <InputNumber aria-label={t('walkin.children')} min={0} max={20} value={children} onChange={(v) => setChildren(v ?? 0)} />
        </Form.Item>
      </Flex>
      <Flex gap="0 12px" wrap>
        <Form.Item label={t('fields.roomType')} style={{ flex: '1 1 200px' }}>
          <Select
            aria-label={t('fields.roomType')}
            value={roomTypeId}
            onChange={(v) => {
              setRoomTypeId(v);
              setRoomId(undefined);
            }}
            options={(types.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
          />
        </Form.Item>
        <Form.Item label={t('walkin.ratePlan')} style={{ flex: '1 1 200px' }}>
          <Select
            aria-label={t('walkin.ratePlan')}
            value={ratePlanId}
            onChange={setRatePlanId}
            options={(plans.data ?? []).filter((p) => p.isActive).map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))}
          />
        </Form.Item>
        <Form.Item label={t('fields.room')} style={{ flex: '1 1 200px' }} extra={t('walkin.autoRoom')}>
          <Select
            aria-label={t('fields.room')}
            allowClear
            value={roomId}
            onChange={setRoomId}
            loading={rooms.isLoading}
            options={clean.map((r) => ({
              value: r.id,
              label: (
                <Space>
                  <strong>{r.number}</strong>
                  <Tag color={r.clean ? 'success' : 'warning'}>{t(`hk.${r.hkStatus}`)}</Tag>
                </Space>
              ),
            }))}
          />
        </Form.Item>
      </Flex>
      {chosen && !chosen.clean ? (
        <Checkbox checked={override} onChange={(e) => setOverride(e.target.checked)}>
          {t('checkin.overrideDirty')}
        </Checkbox>
      ) : null}

      <Divider orientation="left" plain>
        {t('walkin.guest')}
      </Divider>
      <Form.Item label={t('walkin.existingGuest')}>
        <Select
          showSearch
          allowClear
          filterOption={false}
          aria-label={t('walkin.existingGuest')}
          placeholder={t('walkin.searchGuest')}
          value={guestId ?? undefined}
          onSearch={setSearch}
          onChange={(v) => {
            setGuestId(v ?? null);
            if (!v) {
              loaded.current = null;
              setIdentity(emptyIdentity());
            }
          }}
          options={(found.data ?? []).map((g) => ({
            value: g.id,
            label: `${g.lastName.toUpperCase()} ${g.firstName}${g.phone ? ` — ${g.phone}` : ''}`,
          }))}
        />
      </Form.Item>
      <IdentityFields
        id="walkin"
        value={identity}
        errors={errors}
        storedNumber={storedNumber}
        onChange={setIdentity}
        lockNames={!!guestId}
      />
      {!guestId ? (
        <Flex gap="0 12px" wrap>
          <Form.Item label={t('fields.phone')} style={{ flex: '1 1 220px' }}>
            <Input aria-label={t('fields.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Form.Item>
          <Form.Item label={t('fields.email')} style={{ flex: '1 1 220px' }}>
            <Input aria-label={t('fields.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Form.Item>
        </Flex>
      ) : null}
      <PoliceStayFields value={police} onChange={setPolice} custom={custom} onCustomChange={setCustom} />
      <UploadFields signatureId={signatureId} scanId={scanId} onSignature={setSignatureId} onScan={setScanId} />

      {can('folio.pay') ? (
        <>
          <Checkbox checked={withDeposit} onChange={(e) => setWithDeposit(e.target.checked)}>
            {t('checkin.takeDeposit')}
          </Checkbox>
          {withDeposit ? <DepositFields value={deposit} onChange={setDeposit} currency={currency} /> : null}
        </>
      ) : null}

      <Flex justify="space-between" align="center" style={{ marginTop: 16 }}>
        <Text type="secondary">{t('walkin.hint')}</Text>
        <Button type="primary" disabled={!valid} loading={submit.isPending} onClick={submitNow}>
          {t('walkin.confirm')}
        </Button>
      </Flex>
    </Form>
  );
}
