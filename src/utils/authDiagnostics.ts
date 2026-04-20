import { query } from '../db';

const TABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_STATUS_KEYS = new Set(['active', 'approved', 'enabled', 'verified', 'live']);

const tableColumnCache = new Map<string, { expiresAt: number; columns: Set<string> }>();

type TableName = 'agent' | 'user' | 'customer' | 'referral';
const REGISTRATION_URL = 'https://calculator.atap.solar/agent/registration';

export type AuthErrorPayload = {
  error: string;
  code: string;
  title: string;
  detail: string;
  hint?: string;
  accountStatus?: string | null;
  maskedMobile?: string;
  actionUrl?: string;
  actionLabel?: string;
  systemAlert?: boolean;
  registrationOverview?: RegistrationOverview;
};

export type RegistrationOverview = {
  title: string;
  source: 'email' | 'mobile';
  lookupLabel: string;
  lookupValue: string;
  applicationReceived: {
    status: string;
    detail: string;
    actionUrl?: string;
    actionLabel?: string;
  };
  registeredMobiles: string[];
  registrationStatus: {
    status: string;
    detail: string;
  };
  accountActivated: {
    status: string;
    detail: string;
  };
};

type EmployeeAuthFailure = {
  ok: false;
  status: number;
  payload: AuthErrorPayload;
  localPhone: string;
};

type EmployeeAuthSuccess = {
  ok: true;
  user: Record<string, any>;
  agent: Record<string, any>;
  localPhone: string;
  statusLabel: string | null;
};

export type EmployeeAuthAnalysis = EmployeeAuthFailure | EmployeeAuthSuccess;

export type EmailLookupResult =
  | {
      ok: true;
      payload: {
        message: string;
        code: string;
        title: string;
        detail: string;
        records: Array<{
          maskedMobile: string;
          status: 'pending' | 'approved' | 'blocked';
        }>;
        maskedMobiles: string[];
        hint?: string;
        registrationOverview: RegistrationOverview;
      };
    }
  | {
      ok: false;
      status: number;
      payload: AuthErrorPayload;
    };

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const sanitizeDigits = (value: string) => value.replace(/\D/g, '');

const toEmployeeLocalFormat = (phone: string) => {
  if (phone.startsWith('65')) return phone;
  if (phone.startsWith('60')) return '0' + phone.slice(2);
  if (phone.startsWith('0')) return phone;
  return '0' + phone;
};

const getTableColumns = async (tableName: TableName): Promise<Set<string>> => {
  const cached = tableColumnCache.get(tableName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.columns;
  }

  const result = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );

  const columns = new Set<string>(
    result.rows
      .map((row: { column_name?: string }) => row.column_name)
      .filter((value): value is string => Boolean(value))
  );

  tableColumnCache.set(tableName, {
    columns,
    expiresAt: Date.now() + TABLE_CACHE_TTL_MS
  });

  return columns;
};

const pickFirstColumn = (columns: Set<string>, candidates: string[]) =>
  candidates.find((column) => columns.has(column));

const pickColumns = (columns: Set<string>, candidates: string[]) =>
  candidates.filter((column) => columns.has(column));

const normalizeStatusLabel = (value: unknown) => {
  const label = String(value ?? '').trim();
  return label || null;
};

const normalizeStatusKey = (value: unknown) => {
  const label = normalizeStatusLabel(value);
  return label ? label.toLowerCase() : null;
};

const toLookupStatus = (value: unknown): 'pending' | 'approved' | 'blocked' => {
  const statusKey = normalizeStatusKey(value);
  if (statusKey === 'pending') return 'pending';
  if (statusKey === 'blocked' || statusKey === 'suspended' || statusKey === 'disabled' || statusKey === 'inactive') {
    return 'blocked';
  }
  return 'approved';
};

const maskMobileNumber = (value: string) => {
  const digits = sanitizeDigits(value);

  if (!digits) return '';
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) {
    return `${digits.slice(0, 2)}XXX${digits.slice(-2)}`;
  }

  return `${digits.slice(0, 3)}XXX${digits.slice(6)}`;
};

const buildRegistrationOverview = ({
  source,
  lookupLabel,
  lookupValue,
  applicationReceived,
  registeredMobiles,
  registrationStatus,
  accountActivated
}: Omit<RegistrationOverview, 'title'>): RegistrationOverview => ({
  title: 'Registration Status Overview',
  source,
  lookupLabel,
  lookupValue,
  applicationReceived,
  registeredMobiles,
  registrationStatus,
  accountActivated
});

const buildPhoneCandidates = (cleanPhone: string) => {
  const localPhone = toEmployeeLocalFormat(cleanPhone);
  const isSingapore = cleanPhone.startsWith('65');
  const intlPhone = isSingapore ? cleanPhone : '60' + localPhone.substring(1);
  const malaysiaLocalPhone = isSingapore ? '0' + cleanPhone.slice(2) : localPhone;

  const exactCandidates = Array.from(
    new Set([cleanPhone, localPhone, malaysiaLocalPhone, intlPhone].filter(Boolean))
  );

  const digitCandidates = Array.from(
    new Set(exactCandidates.map((candidate) => sanitizeDigits(candidate)).filter(Boolean))
  );

  return {
    localPhone,
    exactCandidates,
    digitCandidates
  };
};

const buildMissingPhonePayload = (localPhone: string): EmployeeAuthFailure => ({
  ok: false,
  status: 404,
  localPhone,
  payload: {
    error: 'No account found for this mobile number.',
    code: 'PHONE_NOT_FOUND',
    title: 'No Such Mobile Number Detected',
    detail: 'We could not find any registered contact record for this mobile number.',
    hint: 'Double-check the number. If you are not sure which mobile number was registered, use the email lookup below to recover your registered mobile number.',
    maskedMobile: maskMobileNumber(localPhone),
    actionUrl: REGISTRATION_URL,
    actionLabel: 'NEW USER REGISTRATION',
    registrationOverview: buildRegistrationOverview({
      source: 'mobile',
      lookupLabel: 'Mobile Number',
      lookupValue: localPhone,
      applicationReceived: {
        status: 'NOT FOUND',
        detail: 'This mobile number was not found in the database.',
        actionUrl: REGISTRATION_URL,
        actionLabel: 'NEW USER REGISTRATION'
      },
      registeredMobiles: [],
      registrationStatus: {
        status: 'NOT REGISTERED',
        detail: 'No registration record is linked to this mobile number yet.'
      },
      accountActivated: {
        status: 'NO',
        detail: 'Account activation is not available until registration has been created and approved.'
      }
    })
  }
});

const buildUnlinkedAccountPayload = (localPhone: string): EmployeeAuthFailure => ({
  ok: false,
  status: 403,
  localPhone,
  payload: {
    error: 'A contact record exists, but login is not ready yet.',
    code: 'ACCOUNT_NOT_LINKED',
    title: 'Mobile Found, Login Not Ready',
    detail: 'We found this mobile number in the contact database, but no user login is linked to it yet.',
    hint: 'Ask an admin to link this mobile number to a user account before requesting another OTP.',
    maskedMobile: maskMobileNumber(localPhone),
    registrationOverview: buildRegistrationOverview({
      source: 'mobile',
      lookupLabel: 'Mobile Number',
      lookupValue: localPhone,
      applicationReceived: {
        status: 'FOUND',
        detail: 'This mobile number exists in the database.'
      },
      registeredMobiles: [maskMobileNumber(localPhone)].filter(Boolean),
      registrationStatus: {
        status: 'LOGIN NOT READY',
        detail: 'Application is received, but the user login has not been linked by admin yet.'
      },
      accountActivated: {
        status: 'NO',
        detail: 'Account is not activated until the user login is linked and approved.'
      }
    })
  }
});

const buildBlockedStatusPayload = (localPhone: string, statusLabel: string): EmployeeAuthFailure => {
  const statusKey = normalizeStatusKey(statusLabel);
  let title = `Account Found, Status ${statusLabel}`;
  let error = `User account detected, but status is ${statusLabel}.`;
  let hint = 'Please contact an admin to update the account before trying to log in again.';

  if (statusKey === 'pending') {
    title = 'Account Found, Pending Approval';
    error = 'User account detected, but status is pending.';
    hint = 'This account exists but has not been activated yet. Please contact Admin (ally) to approve your registration.';
  } else if (statusKey === 'disabled' || statusKey === 'inactive') {
    title = 'Account Found, Access Disabled';
    error = `User account detected, but status is ${statusLabel}.`;
    hint = 'This login is currently disabled. Please contact an admin to reactivate it.';
  } else if (statusKey === 'suspended' || statusKey === 'blocked') {
    title = 'Account Found, Access Suspended';
    error = `User account detected, but status is ${statusLabel}.`;
    hint = 'This login is currently blocked. Please contact an admin for review.';
  }

  return {
    ok: false,
    status: 403,
    localPhone,
    payload: {
      error,
      code: 'ACCOUNT_STATUS_BLOCKED',
      title,
      detail: `We found the user account linked to this mobile number, but its current status is "${statusLabel}".`,
      hint,
      accountStatus: statusLabel,
      maskedMobile: maskMobileNumber(localPhone),
      registrationOverview: buildRegistrationOverview({
        source: 'mobile',
        lookupLabel: 'Mobile Number',
        lookupValue: localPhone,
        applicationReceived: {
          status: 'FOUND',
          detail: 'This mobile number exists in the database.'
        },
        registeredMobiles: [maskMobileNumber(localPhone)].filter(Boolean),
        registrationStatus: {
          status: statusKey === 'pending' ? 'PENDING' : 'USER BLOCKED',
          detail:
            statusKey === 'pending'
              ? 'Registration is still pending. Please contact ALLY (Admin).'
              : `This account is blocked with status "${statusLabel}".`
        },
        accountActivated: {
          status: 'NO',
          detail:
            statusKey === 'pending'
              ? 'Account activation is not available while registration is pending.'
              : 'Account activation is disabled because this user is blocked.'
        }
      })
    }
  };
};

export const analyzeEmployeeAuthAttempt = async (cleanPhone: string): Promise<EmployeeAuthAnalysis> => {
  const { localPhone, exactCandidates, digitCandidates } = buildPhoneCandidates(cleanPhone);
  const agentColumns = await getTableColumns('agent');
  const userColumns = await getTableColumns('user');

  const agentStatusColumn = pickFirstColumn(agentColumns, [
    'status',
    'account_status',
    'user_status',
    'employment_status'
  ]);

  const userStatusColumn = pickFirstColumn(userColumns, [
    'status',
    'account_status',
    'user_status',
    'employment_status'
  ]);

  const agentSelect = ['a.bubble_id', 'a.name', 'a.contact'];
  if (agentStatusColumn) {
    agentSelect.push(`a.${quoteIdentifier(agentStatusColumn)} AS agent_status`);
  }

  const agentResult = await query(
    `SELECT ${agentSelect.join(', ')}
     FROM agent a
     WHERE a.contact = ANY($1::text[])
        OR regexp_replace(coalesce(a.contact, ''), '\\D', '', 'g') = ANY($2::text[])
     ORDER BY a.bubble_id ASC
     LIMIT 5`,
    [exactCandidates, digitCandidates]
  );

  if (agentResult.rows.length === 0) {
    return buildMissingPhonePayload(localPhone);
  }

  const agentIds = agentResult.rows.map((row: Record<string, any>) => String(row.bubble_id));
  const userSelect = ['u.id', 'u.linked_agent_profile', 'u.access_level'];
  if (userStatusColumn) {
    userSelect.push(`u.${quoteIdentifier(userStatusColumn)} AS user_status`);
  }

  const userResult = await query(
    `SELECT ${userSelect.join(', ')}
     FROM "user" u
     WHERE u.linked_agent_profile::text = ANY($1::text[])
     ORDER BY u.id ASC`,
    [agentIds]
  );

  let matchedAgent = agentResult.rows[0] as Record<string, any>;
  let matchedUser =
    userResult.rows.find(
      (row: Record<string, any>) => String(row.linked_agent_profile) === String(matchedAgent.bubble_id)
    ) || null;

  if (!matchedUser) {
    for (const agent of agentResult.rows as Record<string, any>[]) {
      const linkedUser = userResult.rows.find(
        (row: Record<string, any>) => String(row.linked_agent_profile) === String(agent.bubble_id)
      );

      if (linkedUser) {
        matchedAgent = agent;
        matchedUser = linkedUser as Record<string, any>;
        break;
      }
    }
  }

  if (!matchedUser) {
    return buildUnlinkedAccountPayload(localPhone);
  }

  const statusLabel = normalizeStatusLabel(matchedUser.user_status ?? matchedAgent.agent_status);
  const statusKey = normalizeStatusKey(statusLabel);

  if (statusKey && !ACTIVE_STATUS_KEYS.has(statusKey)) {
    return buildBlockedStatusPayload(localPhone, statusLabel || 'Unknown');
  }

  return {
    ok: true,
    user: matchedUser,
    agent: matchedAgent,
    localPhone,
    statusLabel
  };
};

const buildEmailLookupUnavailablePayload = (): EmailLookupResult => ({
  ok: false,
  status: 503,
  payload: {
    error: 'Email lookup is not available for this database yet.',
    code: 'EMAIL_LOOKUP_UNAVAILABLE',
    title: 'Email Lookup Not Configured',
    detail: 'This auth database does not expose an email field that can be matched to registered mobile numbers.',
    hint: 'Please contact support with your registered email so an admin can check it manually.',
    systemAlert: true
  }
});

export const lookupRegisteredMobilesByEmail = async (email: string): Promise<EmailLookupResult> => {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return {
      ok: false,
      status: 400,
      payload: {
        error: 'Email address is required.',
        code: 'EMAIL_REQUIRED',
        title: 'Email Address Required',
        detail: 'Please enter the email address linked to your account.',
        hint: 'Use the same email address that was registered in the system.'
      }
    };
  }

  const [agentColumns, userColumns, customerColumns, referralColumns] = await Promise.all([
    getTableColumns('agent'),
    getTableColumns('user'),
    getTableColumns('customer'),
    getTableColumns('referral')
  ]);

  const queryParts: string[] = [];
  const emailCandidates = [
    'email',
    'email_address',
    'work_email',
    'personal_email',
    'contact_email',
    'registered_email',
    'login_email'
  ];

  const agentEmailColumns = pickColumns(agentColumns, emailCandidates);
  if (agentColumns.has('contact') && agentEmailColumns.length > 0) {
    const conditions = agentEmailColumns
      .map((column) => `lower(trim(coalesce(a.${quoteIdentifier(column)}, ''))) = $1`)
      .join(' OR ');

    queryParts.push(
      `SELECT a.contact AS phone_number,
              ${agentColumns.has('status') ? "a.status" : "NULL"} AS account_status
       FROM agent a
       WHERE ${conditions}`
    );
  }

  const userEmailColumns = pickColumns(userColumns, emailCandidates);
  if (
    userColumns.has('linked_agent_profile') &&
    agentColumns.has('bubble_id') &&
    agentColumns.has('contact') &&
    userEmailColumns.length > 0
  ) {
    const conditions = userEmailColumns
      .map((column) => `lower(trim(coalesce(u.${quoteIdentifier(column)}, ''))) = $1`)
      .join(' OR ');

    queryParts.push(
      `SELECT a.contact AS phone_number,
              ${
                userColumns.has('status')
                  ? 'u.status'
                  : agentColumns.has('status')
                    ? 'a.status'
                    : 'NULL'
              } AS account_status
       FROM "user" u
       JOIN agent a ON a.bubble_id::text = u.linked_agent_profile::text
       WHERE ${conditions}`
    );
  }

  const customerEmailColumns = pickColumns(customerColumns, emailCandidates);
  if (customerColumns.has('phone') && customerEmailColumns.length > 0) {
    const conditions = customerEmailColumns
      .map((column) => `lower(trim(coalesce(c.${quoteIdentifier(column)}, ''))) = $1`)
      .join(' OR ');

    queryParts.push(
      `SELECT c.phone AS phone_number,
              NULL AS account_status
       FROM customer c
       WHERE ${conditions}`
    );
  }

  const referralEmailColumns = pickColumns(referralColumns, emailCandidates);
  if (referralColumns.has('mobile_number') && referralEmailColumns.length > 0) {
    const conditions = referralEmailColumns
      .map((column) => `lower(trim(coalesce(r.${quoteIdentifier(column)}, ''))) = $1`)
      .join(' OR ');

    queryParts.push(
      `SELECT r.mobile_number AS phone_number,
              ${referralColumns.has('status') ? 'r.status' : 'NULL'} AS account_status
       FROM referral r
       WHERE ${conditions}`
    );
  }

  if (queryParts.length === 0) {
    return buildEmailLookupUnavailablePayload();
  }

  const result = await query(queryParts.join(' UNION ALL '), [normalizedEmail]);
  const maskedMobiles = Array.from(
    new Set(
      result.rows
        .map((row: { phone_number?: string }) => maskMobileNumber(String(row.phone_number || '')))
        .filter(Boolean)
    )
  );

  if (maskedMobiles.length === 0) {
    return {
      ok: false,
      status: 404,
      payload: {
        error: 'This email is not found in Database.',
        code: 'EMAIL_NOT_FOUND',
        title: 'Email Not Found',
        detail: 'This email is not found in Database.',
        hint: 'Try another email address, or register as a new user if you have not signed up yet.',
        actionUrl: REGISTRATION_URL,
        actionLabel: 'NEW USER REGISTRATION',
        registrationOverview: buildRegistrationOverview({
          source: 'email',
          lookupLabel: 'Email Address',
          lookupValue: normalizedEmail,
          applicationReceived: {
            status: 'NOT FOUND',
            detail: 'The email address and mobile number were not found in the database.',
            actionUrl: REGISTRATION_URL,
            actionLabel: 'NEW USER REGISTRATION'
          },
          registeredMobiles: [],
          registrationStatus: {
            status: 'NOT REGISTERED',
            detail: 'No registration record is linked to this email address yet.'
          },
          accountActivated: {
            status: 'NO',
            detail: 'Account activation is not available until registration has been created and approved.'
          }
        })
      }
    };
  }

  const recordMap = new Map<string, { maskedMobile: string; status: 'pending' | 'approved' | 'blocked' }>();
  for (const row of result.rows as Array<{ phone_number?: string; account_status?: string | null }>) {
    const maskedMobile = maskMobileNumber(String(row.phone_number || ''));
    if (!maskedMobile) continue;

    const status = toLookupStatus(row.account_status);
    recordMap.set(`${maskedMobile}:${status}`, {
      maskedMobile,
      status
    });
  }

  const records = Array.from(recordMap.values());
  const hasPending = records.some((record) => record.status === 'pending');
  const hasBlocked = records.some((record) => record.status === 'blocked');
  const registrationStatus = hasBlocked ? 'USER BLOCKED' : hasPending ? 'PENDING' : 'APPROVED';
  const registrationDetail = hasBlocked
    ? 'One or more registrations linked to this email are blocked.'
    : hasPending
      ? 'Registration is still pending. Please contact ALLY (Admin).'
      : 'No pending or blocked registration was found for this email.';
  const activatedDetail =
    hasBlocked || hasPending
      ? 'Account is not activated because the registration is still pending or blocked.'
      : 'Account is activated because there is no pending and no blocked registration.';

  return {
    ok: true,
    payload: {
      message: 'Email is found in Database.',
      code: 'REGISTERED_MOBILE_FOUND',
      title: 'Email Found',
      detail:
        records.length === 1
          ? `Email is found in Database. Recorded mobile number = ${records[0].maskedMobile}, status = ${records[0].status}.`
          : `Email is found in Database. We found ${records.length} recorded mobile numbers linked to this email address.`,
      records,
      maskedMobiles,
      hint: 'Use the matching mobile number above on the login form.',
      registrationOverview: buildRegistrationOverview({
        source: 'email',
        lookupLabel: 'Email Address',
        lookupValue: normalizedEmail,
        applicationReceived: {
          status: 'FOUND',
          detail: 'Email address and mobile number were found in the database.'
        },
        registeredMobiles: maskedMobiles,
        registrationStatus: {
          status: registrationStatus,
          detail: registrationDetail
        },
        accountActivated: {
          status: hasBlocked || hasPending ? 'NO' : 'YES',
          detail: activatedDetail
        }
      })
    }
  };
};
