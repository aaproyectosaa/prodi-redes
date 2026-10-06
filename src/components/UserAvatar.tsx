import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Profile } from '@/integrations/firebase/types';

interface UserAvatarProps {
  profile: Profile;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const UserAvatar = ({ profile, className = '', size = 'md' }: UserAvatarProps) => {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
  };

  const textSizeClasses = {
    sm: 'text-[10px]',
    md: 'text-sm',
    lg: 'text-base',
  };

  const getUserInitials = () => {
    if (!profile.nombre) return profile.email?.[0]?.toUpperCase() || 'U';
    return profile.nombre
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const avatarColor = profile.avatarColor || '#3b82f6';

  return (
    <Avatar className={`${sizeClasses[size]} ${className}`}>
      {profile.profileImage ? (
        <AvatarImage src={profile.profileImage} alt={profile.nombre} />
      ) : (
        <AvatarFallback 
          style={{ backgroundColor: avatarColor }} 
          className={`text-white ${textSizeClasses[size]}`}
        >
          {getUserInitials()}
        </AvatarFallback>
      )}
    </Avatar>
  );
};

export default UserAvatar;
