import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for the server's classic JSX transform.
import React, { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Image, Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { shouldShowResumeHeader } from "../shared/cover-letter";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { getTemplatePageMinHeightStyle, getTemplatePageSize } from "../shared/page-size";
import { hasTemplatePicture } from "../shared/picture";
import { Heading, Text } from "../shared/primitives";
import { createRtlStyleHelpers } from "../shared/rtl";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight, resolvePlacementColor } from "../shared/styles";

type PikachuStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	layout: Style;
	sidebarColumn: Style;
	sidebarContent: Style;
	mainColumn: Style;
	headerRow: Style;
	header: Style;
	headerDivider: Style;
	headerIdentity: Style;
	headerName: Style;
	headerText: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
};

type PikachuTemplate = {
	colors: TemplateColorRoles;
	styles: PikachuStyles;
};

type PikachuHeaderProps = {
	styles: PikachuStyles;
	colors: TemplateColorRoles;
};

const pikachuFeatures = {
	stackSidebarItemHeader: true,
} satisfies TemplateFeatures;

export const PikachuPage = ({ page, pageIndex }: TemplatePageProps) => {
	const data = useRender();
	const { metadata, picture } = data;
	const { colors, styles } = usePikachuTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const pageSize = getTemplatePageSize(metadata.page.format);
	const pageMinHeightStyle = getTemplatePageMinHeightStyle(metadata.page.format);
	const showHeader = shouldShowResumeHeader(data, pageIndex);
	const showSidebar = !page.fullWidth;
	const hasPicture = hasTemplatePicture(picture);
	const mainSections = filterSections(page.main, data);
	const sidebarSections = filterSections(page.sidebar, data);

	return (
		<Page size={pageSize} style={composeStyles(styles.page, pageMinHeightStyle)}>
			<TemplateProvider styles={styles} colors={colors} features={pikachuFeatures}>
				<View style={styles.layout}>
					{showSidebar && (
						<View
							style={composeStyles(styles.sidebarColumn, {
								width: `${metadata.layout.sidebarWidth}%`,
								rowGap: metrics.sectionGap,
							})}
						>
							{showHeader && showSidebar && hasPicture && <Image src={picture.url} style={styles.picture} />}

							<View style={composeStyles(styles.sidebarContent, { rowGap: metrics.sectionGap })}>
								{sidebarSections.map((section) => (
									<Section key={section} section={section} placement="sidebar" />
								))}
							</View>
						</View>
					)}

					<View style={composeStyles(styles.mainColumn, { rowGap: metrics.sectionGap })}>
						{showHeader && (
							<View style={styles.headerRow}>
								{showHeader && !showSidebar && hasPicture && <Image src={picture.url} style={styles.picture} />}
								<Header styles={styles} colors={colors} />
							</View>
						)}

						<View style={{ rowGap: metrics.sectionGap }}>
							{mainSections.map((section) => (
								<Section key={section} section={section} placement="main" />
							))}
						</View>
					</View>
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles, colors }: PikachuHeaderProps) => {
	const { basics } = useRender();

	return (
		<View style={styles.header}>
			<View style={styles.headerDivider}>
				<View style={styles.headerIdentity}>
					<Heading style={styles.headerName}>{basics.name}</Heading>
					<Text style={styles.headerText}>{basics.headline}</Text>
				</View>
			</View>

			<View style={styles.contactList}>
				<EmailContactItem
					email={basics.email}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				<PhoneContactItem
					phone={basics.phone}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				<LocationContactItem
					location={basics.location}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				<WebsiteContactItem
					website={basics.website}
					style={styles.contactItem}
					textStyle={styles.headerText}
					iconColor={colors.background}
				/>
				{basics.customFields.map((field) => (
					<CustomFieldContactItem
						key={field.id}
						field={field}
						style={styles.contactItem}
						textStyle={styles.headerText}
						iconColor={colors.background}
					/>
				))}
			</View>
		</View>
	);
};

const usePikachuTemplate = (): PikachuTemplate => {
	const { picture, metadata, rtl } = useRender();

	return useMemo(() => {
		const r = createRtlStyleHelpers(rtl);
		const foreground = rgbaStringToHex(metadata.design.colors.text);
		const background = rgbaStringToHex(metadata.design.colors.background);
		const primary = rgbaStringToHex(metadata.design.colors.primary);
		const colors: TemplateColorRoles = { foreground, background, primary };
		const metrics = getTemplateMetrics(metadata.page);

		const base = createBaseTemplateStyles({ metadata, foreground, r, metrics, picture });

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				color: foreground,
				backgroundColor: background,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				fontFamily: metadata.typography.body.fontFamily,
				fontSize: metadata.typography.body.fontSize,
				lineHeight: metadata.typography.body.lineHeight,
				direction: r.pageDirection,
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
			sectionHeading: {
				borderBottomWidth: 1,
				borderBottomColor: primary,
			},
			item: {
				rowGap: metrics.gapY(0.125),
			},
			levelContainer: {
				width: "100%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
			layout: {
				flexDirection: r.row,
				columnGap: metrics.columnGap,
			},
			sidebarColumn: {
				flexShrink: 0,
			},
			sidebarContent: {
				overflow: "hidden",
			},
			mainColumn: {
				flex: 1,
			},
			headerRow: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1),
			},
			header: {
				flex: 1,
				rowGap: metrics.gapY(0.5),
				backgroundColor: primary,
				color: background,
				borderRadius: picture.borderRadius,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			headerDivider: {
				rowGap: metrics.gapY(0.125),
				borderBottomWidth: 1,
				borderBottomColor: background,
				paddingBottom: metrics.gapY(0.5),
			},
			headerIdentity: {
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				color: background,
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
			},
			headerText: {
				color: background,
			},
			contactList: {
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(0.75),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;
		const foregroundFor = (context: TemplateStyleContext) =>
			resolvePlacementColor({
				placement: context.placement,
				defaultForeground: colors.foreground,
				sidebarForeground: colors.sidebarForeground,
			});

		return {
			colors,
			styles: {
				...baseStyles,
				text: (context) => ({ ...base.text, color: foregroundFor(context) }),
				heading: (context) => ({ ...baseStyles.heading, color: foregroundFor(context) }),
				link: (context) => ({ ...baseStyles.link, color: foregroundFor(context) }),
				sectionHeading: (context) => ({ ...baseStyles.sectionHeading, color: accentFor(context) }),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: accentFor(context),
				}),
			} satisfies PikachuStyles,
		};
	}, [picture, metadata, rtl]);
};
