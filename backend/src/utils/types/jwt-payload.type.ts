// import { Session } from '../../../session/domain/session';
// import { User } from '../../../users/domain/user';
// CBK CBK FIXME: when user id done import here
// export type JwtPayloadType = Pick<User, 'id' | 'role'> & {
export type JwtPayloadType = Pick<any, 'id' | 'role'> & {
  // email: User['email'];
  // sessionId: Session['id'];
  partnershipId?: number | null;
  organization?: number | null;
  iat: number;
  exp: number;
};
