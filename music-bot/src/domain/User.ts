/** Domain user — wraps the wire user and adds role-based permissions. */
export class User {
  constructor(
    public readonly id: string,
    public readonly username: string,
    public readonly roles: string[] = [],
    public readonly isBot: boolean = false
  ) {}

  /** The clone doesn't assign roles, so this only passes when roles are fed
   *  in from elsewhere (kept for the PermissionCheckHandler contract). */
  hasPermission(permission: string): boolean {
    return this.roles.includes(permission);
  }
}
