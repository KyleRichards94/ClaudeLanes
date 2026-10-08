import { ScrollView, StyleSheet, View } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { routes, useNavigation } from '@/shared/routing';
import { CardStatesSheet } from './CardStatesSheet';
import { PrimitivesSheet } from './PrimitivesSheet';
import { TeamBoardSheet } from './TeamBoardSheet';
import { TokensSheet } from './TokensSheet';

/**
 * Component gallery (AL-032): the tokens sheet and every card state, laid out like artboards 7 and 6
 * for side-by-side checks against `docs/design/screens/07-design-tokens.png` and
 * `06-card-states.png`, then every primitive in `packages/ui`.
 *
 * Development only: the `gallery` route opens it under `pnpm dev` (`#/gallery`); production builds
 * leave this page out (see `app/routing`).
 */
export function GalleryPage() {
  const { navigate } = useNavigation();

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} testID="gallery-page">
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text variant="display" size="xl" role="heading" aria-level={1}>
            Component gallery
          </Text>
          <Text variant="meta" size="md">
            Development only. Compare with docs/design/screens/07-design-tokens.png and 06-card-states.png.
          </Text>
        </View>
        <Button label="Board" icon="arrow-left" variant="secondary" onPress={() => navigate(routes.board())} />
      </View>
      <TokensSheet />
      <CardStatesSheet />
      <TeamBoardSheet />
      <PrimitivesSheet />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    gap: space.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  heading: {
    flex: 1,
    gap: space.xs,
  },
});
