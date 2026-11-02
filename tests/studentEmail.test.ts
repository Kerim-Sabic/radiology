import { describe, expect, it } from 'vitest';
import { academicEmail } from '../shared/studentDiscount';

describe('academic email namespaces', () => {
  it.each(['student@harvard.edu', 'Student@HARVARD.EDU', ' student@uni.edu ', 'student@stu.ssst.edu.ba', 'student@ox.ac.uk', 'student@uni.edu.au', 'student@uni.ac.jp', 'student@uni.edu.tr'])('recognizes %s', email => expect(academicEmail(email)).toBe(true));
  it.each([null, undefined, 123, '', 'a@edu', 'a@edu.ba', '@school.edu', 'a@@school.edu', 'a b@school.edu', 'a@school.edu.evil.com', 'a@fakeedu', 'a@not-ac.uk', 'a@gmail.com', 'a@school.edu.com', 'a@-school.edu', 'a@school..edu', 'a@school.edu.', 'a@school.edu/path'])('rejects malformed or unrelated domains: %j', email => expect(academicEmail(email)).toBe(false));
});
