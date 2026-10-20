export const ACTIONS = ['view', 'create', 'edit', 'delete'];
export const FEATURES = [
  ['employees', 'Employees'], ['departments', 'Departments'], ['roles', 'Roles'],
  ['leaveApprovals', 'Leave Approvals'], ['holidays', 'Holidays'],
  ['meetingRooms', 'Meeting Rooms'], ['settings', 'Settings'], ['logs', 'Logs']
];
export function emptyPermissions() {
  return Object.fromEntries(FEATURES.map(([key]) => [key, Object.fromEntries(ACTIONS.map(action => [action, false]))]));
}
function preset(scope) {
  const permissions = emptyPermissions();
  for (const [key] of FEATURES) permissions[key].view = true;
  permissions.leaveApprovals.create = true;
  if (scope !== 'self') permissions.leaveApprovals.edit = true;
  if (scope === 'global') {
    for (const key of ['employees', 'departments', 'roles', 'holidays', 'meetingRooms']) {
      permissions[key].create = true; permissions[key].edit = true;
    }
    permissions.roles.delete = true;
  }
  return permissions;
}
// Existing system roles keep their original access. New roles do not promote old accounts.
export const SYSTEM_ROLES = [
  { name: 'Dev', scope: 'self', permissions: preset('self') },
  { name: 'Employee', scope: 'self', permissions: preset('self') },
  { name: 'Manager', scope: 'team', permissions: preset('team') },
  { name: 'Owner', scope: 'team', permissions: preset('team') },
  { name: 'RH', scope: 'global', permissions: preset('global') }
];
export function roleScope(employee) {
  return employee.access_scope || SYSTEM_ROLES.find(role => role.name === employee.role)?.scope || 'self';
}
export function hasPermission(employee, feature, action) {
  const permissions = employee.permissions || SYSTEM_ROLES.find(role => role.name === employee.role)?.permissions;
  return permissions?.[feature]?.[action] === true;
}
export function canGrantRole(actor, role) {
  const rank = { self: 0, team: 1, global: 2 };
  return rank[role.scope] <= rank[roleScope(actor)] && FEATURES.every(([key]) => ACTIONS.every(action => !role.permissions[key][action] || hasPermission(actor, key, action)));
}
export function storedRole(name) {
  return name === 'RH' ? 'RH' : ['Owner', 'Manager'].includes(name) ? 'Owner' : 'Dev';
}
