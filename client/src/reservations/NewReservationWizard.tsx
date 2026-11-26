import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useApiError } from '../auth/useApiError';
import { formatMoney } from '../pages/settings/util';
import { addDays, conflictDetails, formatDayLong, get, nightsBetween, post, qs } from './api';
import type {
  Availability,
  CustomFieldDef,
  Guest,
  Page,
  Reservation,
  ReservationResult,
  Warning,
} from './api';
import { useActiveProperty } from './property';
import { localizeTypes, useCustomFieldDefs, useLabel, useLookup } from './refs';

const { Text } = Typography;

export interface WizardInitial {
  propertyId?: string;
  arrival?: string;
  departure?: string;
  adults?: number;
  roomTypeId?: string;
  /** Room to assign to the first line (planning quick-create). */
  roomId?: string;
}

interface Line {
  roomTypeId: string;
  ratePlanId: string;
  qty: number;
  roomId?: string | undefined;
}

export type GuestChoice =
  | { kind: 'existing'; guest: Guest }
  | { kind: 'new'; firstName: string; lastName: string; phone: string; email: string };

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Debounced value (guest search). */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const STEPS = ['stay', 'availability', 'guest', 'details', 'summary'] as const;

/**
 * New reservation (OP-11/12/13): dates and guests → availability and prices by room type and
 * rate plan → rooms → guest (search or create, blacklist warning) → source / notes / custom
 * fields / PENDING option or CONFIRMED → summary → create (Idempotency-Key).
 * When nothing is available the same flow adds the guest to the waitlist.
 */
export function NewReservationWizard({
  initial,
  onDone,
}: {
  initial?: WizardInitial;
  onDone?: (r: Reservation) => void;
}) {
  const { t, i18n } = useTranslation('reservations');
  const toMessage = useApiError();
  const navigate = useNavigate();
  const active = useActiveProperty();
  const propertyId = initial?.propertyId ?? active.propertyId;

  const [arrival, setArrival] = useState(initial?.arrival ?? todayLocal());
  const [departure, setDeparture] = useState(
    initial?.departure ?? addDays(initial?.arrival ?? todayLocal(), 1),
  );
  const [adults, setAdults] = useState(initial?.adults ?? 2);
  const [children, setChildren] = useState(0);
  const [step, setStep] = useState(initial?.arrival ? 1 : 0);
  const [lines, setLines] = useState<Line[]>([]);
  const [guest, setGuest] = useState<GuestChoice | null>(null);
  const [source, setSource] = useState<string>();
  const [segment, setSegment] = useState<string>();
  const [notes, setNotes] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED');
  const [expiry, setExpiry] = useState('');
  const [waitlist, setWaitlist] = useState(false);
  const [created, setCreated] = useState<{ reservation: Reservation; warnings: Warning[] } | null>(
    null,
  );

  const nights = Math.max(0, nightsBetween(arrival, departure));
  const stayValid = nights > 0 && adults >= 1;

  // Availability (step 2): free units per type and prices per rate plan.
  const availability = useQuery({
    queryKey: ['availability', propertyId, arrival, departure, adults, children],
    queryFn: () =>
      get<Availability>(
        `/availability${qs({ propertyId, arrival, departure, adults, children, rooms: 1 })}`,
      ),
    enabled: !!propertyId && stayValid && step >= 1,
  });
  const types = useMemo(
    () => localizeTypes(availability.data?.roomTypes ?? [], i18n.language),
    [availability.data, i18n.language],
  );
  const anySellable = types.some((x) => x.sellable);

  // Planning quick-create: preselect the clicked room's type with its first available rate plan.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !initial?.roomTypeId || !types.length) return;
    preselected.current = true;
    const type = types.find((x) => x.roomTypeId === initial.roomTypeId);
    const plan = type?.ratePlans.find((p) => p.available);
    if (type?.sellable && plan)
      setLines([
        {
          roomTypeId: type.roomTypeId,
          ratePlanId: plan.ratePlanId,
          qty: 1,
          roomId: initial.roomId,
        },
      ]);
  }, [types, initial]);

  const setQty = (roomTypeId: string, ratePlanId: string, qty: number) =>
    setLines((prev) => {
      const rest = prev.filter(
        (l) => !(l.roomTypeId === roomTypeId && l.ratePlanId === ratePlanId),
      );
      const old = prev.find((l) => l.roomTypeId === roomTypeId && l.ratePlanId === ratePlanId);
      return qty > 0 ? [...rest, { roomTypeId, ratePlanId, qty, roomId: old?.roomId }] : rest;
    });
  const qtyOf = (rt: string, rp: string) =>
    lines.find((l) => l.roomTypeId === rt && l.ratePlanId === rp)?.qty ?? 0;
  const usedOfType = (rt: string) =>
    lines.filter((l) => l.roomTypeId === rt).reduce((n, l) => n + l.qty, 0);

  const priced = useMemo(
    () =>
      lines.map((l) => {
        const type = types.find((x) => x.roomTypeId === l.roomTypeId);
        const plan = type?.ratePlans.find((p) => p.ratePlanId === l.ratePlanId);
        return { line: l, type, plan, total: (plan?.quote?.total ?? 0) * l.qty };
      }),
    [lines, types],
  );
  const grandTotal = priced.reduce((n, p) => n + p.total, 0);
  const currency = priced.find((p) => p.plan?.quote)?.plan?.quote?.currency ?? 'XOF';

  // Idempotency-Key: stable for retries of the same payload, renewed when the payload changes.
  const idem = useRef<{ key: string; body: string } | null>(null);
  const buildBody = () => {
    const g = guest!;
    return {
      propertyId,
      arrival,
      departure,
      guest:
        g.kind === 'existing'
          ? { id: g.guest.id }
          : {
              firstName: g.firstName.trim(),
              lastName: g.lastName.trim(),
              ...(g.phone.trim() ? { phone: g.phone.trim() } : {}),
              ...(g.email.trim() ? { email: g.email.trim() } : {}),
            },
      rooms: lines.flatMap((l) =>
        Array.from({ length: l.qty }, (_, i) => ({
          roomTypeId: l.roomTypeId,
          ratePlanId: l.ratePlanId,
          adults,
          children,
          ...(l.roomId && i === 0 ? { roomId: l.roomId } : {}),
        })),
      ),
      status,
      ...(status === 'PENDING' && expiry
        ? { optionExpiresAt: new Date(expiry).toISOString() }
        : {}),
      channel: 'FRONT_DESK',
      ...(source ? { source } : {}),
      ...(segment ? { segment } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(Object.keys(custom).length ? { customFields: custom } : {}),
    };
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (waitlist) {
        const g = guest!;
        const body = {
          propertyId,
          guest:
            g.kind === 'existing'
              ? { id: g.guest.id }
              : {
                  firstName: g.firstName.trim(),
                  lastName: g.lastName.trim(),
                  ...(g.phone.trim() ? { phone: g.phone.trim() } : {}),
                  ...(g.email.trim() ? { email: g.email.trim() } : {}),
                },
          arrival,
          departure,
          adults,
          children,
          ...(initial?.roomTypeId ? { roomTypeId: initial.roomTypeId } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
        await post('/waitlist', body);
        return null;
      }
      const body = buildBody();
      const serial = JSON.stringify(body);
      if (idem.current?.body !== serial) idem.current = { key: crypto.randomUUID(), body: serial };
      return post<ReservationResult>('/reservations', body, {
        'Idempotency-Key': idem.current.key,
      });
    },
    onSuccess: (res) => {
      if (res) {
        setCreated(res);
        onDone?.(res.reservation);
      } else setCreated({ reservation: null as unknown as Reservation, warnings: [] });
    },
  });

  if (created) {
    const r = created.reservation;
    return (
      <Result
        status="success"
        title={r ? t('wizard.createdTitle', { number: r.number }) : t('wizard.waitlistedTitle')}
        subTitle={r ? t('wizard.createdSub') : t('wizard.waitlistedSub')}
        extra={[
          r ? (
            <Button
              key="open"
              type="primary"
              onClick={() => navigate(`/reservations?open=${r.id}`)}
            >
              {t('wizard.open')}
            </Button>
          ) : (
            <Button key="wl" type="primary" onClick={() => navigate('/waitlist')}>
              {t('wizard.openWaitlist')}
            </Button>
          ),
        ]}
      >
        {created.warnings.map((w) => (
          <Alert
            key={w.code}
            type="warning"
            showIcon
            message={w.message}
            style={{ marginBottom: 8 }}
          />
        ))}
      </Result>
    );
  }

  const canNext = [
    stayValid && !!propertyId,
    waitlist || lines.length > 0,
    !!guest && (guest.kind === 'existing' || (guest.firstName.trim() && guest.lastName.trim())),
    true,
    true,
  ][step]!;
  const stepKeys = waitlist ? ['stay', 'availability', 'guest', 'summary'] : [...STEPS];
  const currentKey = waitlist && step >= 3 ? 'summary' : STEPS[step]!;
  const goNext = () => setStep((s) => (waitlist && s === 2 ? 4 : s + 1));
  const goBack = () => setStep((s) => (waitlist && s === 4 ? 2 : s - 1));
  const stepIndex = Math.max(0, stepKeys.indexOf(currentKey));

  const conflict = conflictDetails(submit.error);

  return (
    <Flex vertical gap={16}>
      <Steps
        size="small"
        current={stepIndex}
        items={stepKeys.map((k) => ({ title: t(`wizard.steps.${k}`) }))}
        responsive
      />

      {currentKey === 'stay' ? (
        <Form layout="vertical" style={{ maxWidth: 520 }}>
          <Flex gap={12} wrap>
            <Form.Item label={t('wizard.arrival')}>
              <Input
                type="date"
                aria-label={t('wizard.arrival')}
                value={arrival}
                onChange={(e) => {
                  const v = e.target.value;
                  setArrival(v);
                  if (v && departure <= v) setDeparture(addDays(v, 1));
                }}
              />
            </Form.Item>
            <Form.Item label={t('wizard.departure')}>
              <Input
                type="date"
                aria-label={t('wizard.departure')}
                value={departure}
                min={addDays(arrival, 1)}
                onChange={(e) => setDeparture(e.target.value)}
              />
            </Form.Item>
          </Flex>
          <Flex gap={12} wrap>
            <Form.Item label={t('wizard.adults')}>
              <InputNumber
                aria-label={t('wizard.adults')}
                min={1}
                max={20}
                value={adults}
                onChange={(v) => setAdults(v ?? 1)}
              />
            </Form.Item>
            <Form.Item label={t('wizard.children')}>
              <InputNumber
                aria-label={t('wizard.children')}
                min={0}
                max={20}
                value={children}
                onChange={(v) => setChildren(v ?? 0)}
              />
            </Form.Item>
          </Flex>
          <Text type="secondary">{t('wizard.nights', { count: nights })}</Text>
        </Form>
      ) : null}

      {currentKey === 'availability' ? (
        <Flex vertical gap={12}>
          <Text type="secondary">
            {formatDayLong(arrival, i18n.language)} → {formatDayLong(departure, i18n.language)} (
            {t('wizard.nights', { count: nights })}, {t('guestsCount', { adults, children })})
          </Text>
          {availability.isLoading ? <Skeleton active /> : null}
          {availability.isError ? (
            <Alert type="error" showIcon message={toMessage(availability.error)} />
          ) : null}
          {availability.data && !anySellable ? (
            <Alert
              type="warning"
              showIcon
              message={t('wizard.nothingAvailable')}
              description={t('wizard.waitlistOffer')}
              action={
                <Button
                  type="primary"
                  onClick={() => {
                    setWaitlist(true);
                    setStep(2);
                  }}
                >
                  {t('wizard.joinWaitlist')}
                </Button>
              }
            />
          ) : null}
          {types.map((rt) => (
            <Card
              key={rt.roomTypeId}
              size="small"
              title={
                <Space>
                  <strong>{rt.name}</strong>
                  <Tag color={rt.sellable ? 'green' : 'red'}>
                    {rt.sellable ? t('wizard.freeUnits', { count: rt.minFree }) : t('wizard.full')}
                  </Tag>
                  {!rt.fitsOccupancy ? (
                    <Tag color="orange">{t('wizard.occupancyExceeded')}</Tag>
                  ) : null}
                </Space>
              }
            >
              {rt.ratePlans.length ? (
                <List
                  size="small"
                  dataSource={rt.ratePlans}
                  renderItem={(p) => {
                    const free =
                      rt.minFree - (usedOfType(rt.roomTypeId) - qtyOf(rt.roomTypeId, p.ratePlanId));
                    const sellable = rt.sellable && p.available;
                    return (
                      <List.Item
                        key={p.ratePlanId}
                        actions={[
                          <InputNumber
                            key="qty"
                            aria-label={t('wizard.qtyFor', { type: rt.name, plan: p.name })}
                            min={0}
                            max={Math.max(0, free)}
                            disabled={!sellable}
                            value={qtyOf(rt.roomTypeId, p.ratePlanId)}
                            onChange={(v) => setQty(rt.roomTypeId, p.ratePlanId, v ?? 0)}
                          />,
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space>
                              {p.name}
                              <Tag>{t(`meal.${p.mealPlan}`, { defaultValue: p.mealPlan })}</Tag>
                            </Space>
                          }
                          description={
                            p.quote ? (
                              <span>
                                <strong>{formatMoney(p.quote.total, p.quote.currency)}</strong>{' '}
                                <Text type="secondary">
                                  (
                                  {formatMoney(
                                    Math.round(p.quote.total / Math.max(1, nights)),
                                    p.quote.currency,
                                  )}{' '}
                                  / {t('wizard.night')})
                                </Text>
                              </span>
                            ) : (
                              <Text type="secondary">
                                {p.message ??
                                  t(`wizard.reason.${p.reason ?? 'NO_RATE'}`, {
                                    defaultValue: p.reason ?? '',
                                  })}
                              </Text>
                            )
                          }
                        />
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('wizard.noRatePlan')} />
              )}
            </Card>
          ))}
          {lines.length ? (
            <Alert
              type="info"
              showIcon
              message={t('wizard.selection', {
                rooms: lines.reduce((n, l) => n + l.qty, 0),
                total: formatMoney(grandTotal, currency),
              })}
            />
          ) : null}
        </Flex>
      ) : null}

      {currentKey === 'guest' ? <GuestStep guest={guest} onChange={setGuest} /> : null}

      {currentKey === 'details' ? (
        <DetailsStep
          source={source}
          setSource={setSource}
          segment={segment}
          setSegment={setSegment}
          notes={notes}
          setNotes={setNotes}
          custom={custom}
          setCustom={setCustom}
          status={status}
          setStatus={setStatus}
          expiry={expiry}
          setExpiry={setExpiry}
        />
      ) : null}

      {currentKey === 'summary' ? (
        <Flex vertical gap={12}>
          {guest?.kind === 'existing' && guest.guest.isBlacklisted ? (
            <Alert type="warning" showIcon message={t('guest.blacklistWarning')} />
          ) : null}
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label={t('wizard.summary.stay')}>
              {formatDayLong(arrival, i18n.language)} → {formatDayLong(departure, i18n.language)} (
              {t('wizard.nights', { count: nights })})
            </Descriptions.Item>
            <Descriptions.Item label={t('wizard.summary.guest')}>
              {guest?.kind === 'existing'
                ? `${guest.guest.firstName} ${guest.guest.lastName}`
                : guest
                  ? `${guest.firstName} ${guest.lastName}`
                  : '-'}
            </Descriptions.Item>
            {waitlist ? (
              <Descriptions.Item label={t('wizard.summary.mode')}>
                {t('wizard.summary.waitlist')}
              </Descriptions.Item>
            ) : (
              <>
                <Descriptions.Item label={t('wizard.summary.rooms')}>
                  {priced.map((p) => (
                    <div key={`${p.line.roomTypeId}${p.line.ratePlanId}`}>
                      {p.line.qty} x {p.type?.name} - {p.plan?.name}
                      {p.line.roomId ? ` (${t('wizard.roomChosen')})` : ''} :{' '}
                      {formatMoney(p.total, currency)}
                    </div>
                  ))}
                </Descriptions.Item>
                <Descriptions.Item label={t('wizard.summary.status')}>
                  {t(`status.${status}`)}
                  {status === 'PENDING' && expiry
                    ? ` (${t('wizard.summary.until', { date: new Date(expiry).toLocaleString(i18n.language) })})`
                    : ''}
                </Descriptions.Item>
                <Descriptions.Item label={t('wizard.summary.total')}>
                  <strong data-testid="grand-total">{formatMoney(grandTotal, currency)}</strong>
                </Descriptions.Item>
              </>
            )}
          </Descriptions>
          {submit.error ? (
            <Alert
              type="error"
              showIcon
              message={toMessage(submit.error)}
              description={
                conflict ? (
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {conflict.short.map((s) => (
                      <li key={s.date}>
                        {t('conflict.shortNight', { date: s.date, free: s.free, needed: s.needed })}
                      </li>
                    ))}
                    {conflict.clashes.map((c) => (
                      <li key={`${c.roomId}${c.date}`}>
                        {t('conflict.clashNight', { date: c.date })}
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
          ) : null}
        </Flex>
      ) : null}

      <Flex justify="space-between">
        <Button disabled={step === 0 || submit.isPending} onClick={goBack}>
          {t('wizard.back')}
        </Button>
        {currentKey === 'summary' ? (
          <Button
            type="primary"
            loading={submit.isPending}
            onClick={() => submit.mutate()}
            disabled={!guest}
          >
            {waitlist ? t('wizard.addToWaitlist') : t('wizard.create')}
          </Button>
        ) : (
          <Button type="primary" disabled={!canNext} onClick={goNext}>
            {t('wizard.next')}
          </Button>
        )}
      </Flex>
    </Flex>
  );
}

export function GuestStep({
  guest,
  onChange,
}: {
  guest: GuestChoice | null;
  onChange: (g: GuestChoice | null) => void;
}) {
  const { t } = useTranslation('reservations');
  const [term, setTerm] = useState('');
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const debounced = useDebounced(term.trim());
  const results = useQuery({
    queryKey: ['guests', 'search', debounced],
    queryFn: () => get<Page<Guest>>(`/guests${qs({ search: debounced, limit: 8 })}`),
    enabled: debounced.length >= 2,
  });
  const draft =
    guest?.kind === 'new'
      ? guest
      : { kind: 'new' as const, firstName: '', lastName: '', phone: '', email: '' };
  return (
    <Flex vertical gap={12}>
      <Radio.Group
        value={mode}
        onChange={(e) => {
          setMode(e.target.value as 'search' | 'new');
          onChange(null);
        }}
        optionType="button"
        options={[
          { value: 'search', label: t('guest.search') },
          { value: 'new', label: t('guest.new') },
        ]}
      />
      {mode === 'search' ? (
        <>
          <Input.Search
            aria-label={t('guest.searchLabel')}
            placeholder={t('guest.searchPlaceholder')}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            allowClear
          />
          {results.data?.items.length === 0 && debounced.length >= 2 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('guest.noResult')} />
          ) : null}
          <List
            size="small"
            dataSource={results.data?.items ?? []}
            renderItem={(g) => (
              <List.Item
                key={g.id}
                actions={[
                  <Button
                    key="pick"
                    type={
                      guest?.kind === 'existing' && guest.guest.id === g.id ? 'primary' : 'default'
                    }
                    onClick={() => onChange({ kind: 'existing', guest: g })}
                  >
                    {guest?.kind === 'existing' && guest.guest.id === g.id
                      ? t('guest.selected')
                      : t('guest.choose')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {g.firstName} {g.lastName}
                      {g.isBlacklisted ? <Tag color="red">{t('guest.blacklisted')}</Tag> : null}
                    </Space>
                  }
                  description={[g.phone, g.email].filter(Boolean).join(' - ')}
                />
              </List.Item>
            )}
          />
          {guest?.kind === 'existing' && guest.guest.isBlacklisted ? (
            <Alert type="warning" showIcon message={t('guest.blacklistWarning')} />
          ) : null}
        </>
      ) : (
        <Form layout="vertical" style={{ maxWidth: 480 }}>
          <Flex gap={12} wrap>
            <Form.Item label={t('guest.firstName')} required>
              <Input
                aria-label={t('guest.firstName')}
                value={draft.firstName}
                onChange={(e) => onChange({ ...draft, firstName: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={t('guest.lastName')} required>
              <Input
                aria-label={t('guest.lastName')}
                value={draft.lastName}
                onChange={(e) => onChange({ ...draft, lastName: e.target.value })}
              />
            </Form.Item>
          </Flex>
          <Flex gap={12} wrap>
            <Form.Item label={t('guest.phone')}>
              <Input
                aria-label={t('guest.phone')}
                value={draft.phone}
                onChange={(e) => onChange({ ...draft, phone: e.target.value })}
              />
            </Form.Item>
            <Form.Item label={t('guest.email')}>
              <Input
                aria-label={t('guest.email')}
                type="email"
                value={draft.email}
                onChange={(e) => onChange({ ...draft, email: e.target.value })}
              />
            </Form.Item>
          </Flex>
        </Form>
      )}
    </Flex>
  );
}

function DetailsStep(p: {
  source: string | undefined;
  setSource: (v: string | undefined) => void;
  segment: string | undefined;
  setSegment: (v: string | undefined) => void;
  notes: string;
  setNotes: (v: string) => void;
  custom: Record<string, unknown>;
  setCustom: (v: Record<string, unknown>) => void;
  status: 'CONFIRMED' | 'PENDING';
  setStatus: (v: 'CONFIRMED' | 'PENDING') => void;
  expiry: string;
  setExpiry: (v: string) => void;
}) {
  const { t } = useTranslation('reservations');
  const label = useLabel();
  const sources = useLookup('reservation_source');
  const segments = useLookup('guest_segment');
  const defs = useCustomFieldDefs('reservation');
  const opts = (list?: { code: string; label: { fr: string; en?: string } }[]) =>
    (list ?? []).map((v) => ({ value: v.code, label: label(v.label) }));
  return (
    <Form layout="vertical" style={{ maxWidth: 560 }}>
      <Flex gap={12} wrap>
        <Form.Item label={t('wizard.source')} style={{ minWidth: 220 }}>
          <Select
            aria-label={t('wizard.source')}
            allowClear
            value={p.source}
            onChange={p.setSource}
            options={opts(sources.data)}
          />
        </Form.Item>
        <Form.Item label={t('wizard.segment')} style={{ minWidth: 220 }}>
          <Select
            aria-label={t('wizard.segment')}
            allowClear
            value={p.segment}
            onChange={p.setSegment}
            options={opts(segments.data)}
          />
        </Form.Item>
      </Flex>
      <Form.Item label={t('wizard.notes')}>
        <Input.TextArea
          aria-label={t('wizard.notes')}
          rows={3}
          value={p.notes}
          onChange={(e) => p.setNotes(e.target.value)}
          maxLength={4000}
        />
      </Form.Item>
      {(defs.data ?? []).map((d) => (
        <Form.Item key={d.key} label={label(d.label)} required={d.required}>
          <CustomInput
            def={d}
            value={p.custom[d.key]}
            onChange={(v) => p.setCustom({ ...p.custom, [d.key]: v })}
          />
        </Form.Item>
      ))}
      <Form.Item label={t('wizard.statusLabel')}>
        <Radio.Group
          value={p.status}
          onChange={(e) => p.setStatus(e.target.value as 'CONFIRMED' | 'PENDING')}
          options={[
            { value: 'CONFIRMED', label: t('status.CONFIRMED') },
            { value: 'PENDING', label: t('wizard.pendingOption') },
          ]}
        />
      </Form.Item>
      {p.status === 'PENDING' ? (
        <Form.Item label={t('wizard.optionExpiry')} extra={t('wizard.optionExpiryHelp')}>
          <Input
            type="datetime-local"
            aria-label={t('wizard.optionExpiry')}
            value={p.expiry}
            onChange={(e) => p.setExpiry(e.target.value)}
          />
        </Form.Item>
      ) : null}
    </Form>
  );
}

function CustomInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = useLabel();
  const opts = (def.options ?? []).map((o) => ({ value: o.value, label: label(o.label) }));
  switch (def.type) {
    case 'NUMBER':
      return (
        <InputNumber
          aria-label={label(def.label)}
          value={value as number | null}
          onChange={onChange}
        />
      );
    case 'BOOLEAN':
      return <Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'DATE':
      return (
        <Input
          type="date"
          aria-label={label(def.label)}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'SELECT':
      return (
        <Select
          aria-label={label(def.label)}
          allowClear
          value={value as string | undefined}
          onChange={onChange}
          options={opts}
        />
      );
    case 'MULTI_SELECT':
      return (
        <Select
          aria-label={label(def.label)}
          mode="multiple"
          value={(value as string[]) ?? []}
          onChange={onChange}
          options={opts}
        />
      );
    default:
      return (
        <Input
          aria-label={label(def.label)}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
