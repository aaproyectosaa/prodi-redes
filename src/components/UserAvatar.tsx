import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Profile } from '@/integrations/firebase/types';
import { useAvatarDe } from '@/lib/avatares';

interface UserAvatarProps {
  profile: Profile;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const UserAvatar = ({ profile, className = '', size = 'md' }: UserAvatarProps) => {
  // Los clientes no leen los perfiles del equipo: la foto les llega por avatares/{uid}.
  const copia = useAvatarDe(profile.profileImage ? undefined : profile.id);
  const img = profile.profileImage || copia;

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

  // La inicial queda de respaldo mientras carga la foto o si el navegador no la puede mostrar.
  return (
    <Avatar className={`${sizeClasses[size]} ${className}`}>
      {img && <AvatarImage src={img} alt={profile.nombre} className="object-cover" />}
      <AvatarFallback
        style={{ backgroundColor: avatarColor }}
        className={`text-white ${textSizeClasses[size]}`}
      >
        {getUserInitials()}
      </AvatarFallback>
    </Avatar>
  );
};

export default UserAvatar;
