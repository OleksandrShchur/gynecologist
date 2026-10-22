export type DirectionIcon = 'surgery' | 'pregnancy' | 'birth' | 'conversation' | 'examination' | 'pediatric'

export interface Direction {
  readonly title: string
  readonly description: string
  readonly icon: DirectionIcon
}

export interface Doctor {
  readonly name: string
  readonly title: string
  readonly initials: string
  readonly motto: string
  readonly instagram: string
  readonly instagramHandle: string
  readonly bio?: readonly string[]
  readonly education?: readonly string[]
  readonly yearsOfExperience?: number
  readonly city?: string
  readonly address?: string
  readonly phone?: string
}

interface SiteContent {
  readonly doctor: Doctor
  readonly navigation: readonly { readonly label: string; readonly href: `#${string}` }[]
  readonly seo: {
    readonly title: string
    readonly description: string
    readonly locale: string
    readonly siteUrl?: string
    readonly ogImage?: string
  }
  readonly labels: {
    readonly skipToContent: string
    readonly navigation: string
    readonly menu: string
    readonly contacts: string
    readonly myInstagram: string
    readonly newTab: string
    readonly education: string
    readonly experience: string
    readonly phone: string
    readonly address: string
    readonly backToTop: string
  }
  readonly hero: {
    readonly eyebrow: string
    readonly mottoLines: readonly string[]
    readonly subtitle: string
    readonly note: string
    readonly explore: string
    readonly caption: string
  }
  readonly directions: {
    readonly eyebrow: string
    readonly heading: string
    readonly intro: string
    readonly items: readonly Direction[]
  }
  readonly approach: {
    readonly eyebrow: string
    readonly heading: string
    readonly intro: string
    readonly principles: readonly { readonly title: string; readonly description: string }[]
  }
  readonly about: {
    readonly eyebrow: string
    readonly heading: string
    readonly intro: string
    readonly directionsLead: string
  }
  readonly contact: {
    readonly eyebrow: string
    readonly heading: string
    readonly description: string
    readonly action: string
  }
  readonly photos: {
    readonly portraitAlt: string
    readonly standingAlt: string
  }
  readonly footer: { readonly note: string }
}

export const site: SiteContent = {
  doctor: {
    name: 'Оксана Перхулин',
    title: 'Акушер-гінеколог',
    initials: 'ОП',
    motto: 'Доказово. Без стресу. З турботою.',
    instagram: 'https://www.instagram.com/o.perhulyn/',
    instagramHandle: '@o.perhulyn',
    // TODO: bio: ['Біографія, погоджена лікаркою.'],
    // TODO: education: ['Підтверджена освіта та кваліфікація.'],
    // TODO: yearsOfExperience: підтверджена кількість років (число).
    // TODO: city: 'Місто практики',
    // TODO: address: 'Назва клініки та адреса',
    // TODO: phone: 'Підтверджений номер у міжнародному форматі',
  },
  navigation: [
    { label: 'Напрями', href: '#napriamy' },
    { label: 'Підхід', href: '#pidkhid' },
    { label: 'Про лікаря', href: '#pro-likaria' },
  ],
  seo: {
    title: 'Оксана Перхулин — акушер-гінеколог',
    description: 'Акушер-гінеколог Оксана Перхулин. Хірургія, вагітність, пологи, консультації, огляди та дитяча гінекологія. Доказово. Без стресу. З турботою.',
    locale: 'uk_UA',
    // TODO: siteUrl: 'https://…' — остаточна публічна адреса сайту.
    // TODO: ogImage: 'https://…' — абсолютна адреса погодженого зображення 1200 × 630.
  },
  labels: {
    skipToContent: 'Перейти до основного вмісту',
    navigation: 'Основна навігація',
    menu: 'Меню',
    contacts: 'Контакти',
    myInstagram: 'Мій Instagram',
    newTab: '(відкриється в новій вкладці)',
    education: 'Освіта',
    experience: 'Років практики',
    phone: 'Телефон',
    address: 'Місце практики',
    backToTop: 'На початок',
  },
  hero: {
    eyebrow: 'Поруч у важливому',
    mottoLines: ['Доказово.', 'Без стресу.', 'З турботою.'],
    subtitle: 'Акушер-гінеколог Оксана Перхулин',
    note: 'З увагою до вас і ваших запитань.',
    explore: 'Познайомимось ближче',
    caption: 'Делікатність починається з уваги',
  },
  directions: {
    eyebrow: 'Напрями практики',
    heading: 'Турбота на різних\nетапах життя',
    intro: 'Від першого запитання до важливих життєвих змін.',
    // DRAFT_REVIEW: усі шість описів нижче — редакційні чернетки для погодження лікаркою.
    items: [
      { title: 'Хірургія', icon: 'surgery', description: 'Зрозуміла розмова про ваші запитання та наступні кроки.' },
      { title: 'Вагітність', icon: 'pregnancy', description: 'Увага до ваших запитань у період очікування.' },
      { title: 'Пологи', icon: 'birth', description: 'Повага до ваших побажань у важливий момент життя.' },
      { title: 'Консультації', icon: 'conversation', description: 'Простір для відвертої розмови про те, що вас хвилює.' },
      { title: 'Огляди', icon: 'examination', description: 'Делікатне спілкування з поясненням кожного кроку.' },
      { title: 'Дитяча гінекологія', icon: 'pediatric', description: 'Уважна розмова з урахуванням віку та відчуттів дитини.' },
    ],
  },
  approach: {
    eyebrow: 'Мій підхід',
    heading: 'Медицина з увагою\nдо людини',
    intro: 'Три прості принципи, що визначають моє ставлення до роботи.',
    principles: [
      { title: 'Доказово', description: 'Увага до доказової медицини та зрозумілих пояснень.' },
      { title: 'Без стресу', description: 'Спокійна розмова, місце для запитань і повага до вашого темпу.' },
      { title: 'З турботою', description: 'Делікатність, уважне слухання та повага до ваших особистих меж.' },
    ],
  },
  about: {
    eyebrow: 'Про лікаря',
    heading: 'Оксана\nПерхулин',
    intro: 'Я — Оксана Перхулин, акушер-гінеколог.',
    directionsLead: 'Напрями моєї практики:',
  },
  contact: {
    eyebrow: 'Контакти',
    heading: 'Будьмо на зв’язку',
    description: 'Познайомтеся з моїм підходом і напишіть мені в Instagram.',
    action: 'Відкрити сторінку',
  },
  photos: {
    portraitAlt: 'Оксана Перхулин у лавандовому медичному костюмі сидить за столом; праворуч — кімнатна рослина.',
    standingAlt: 'Оксана Перхулин стоїть зі схрещеними руками у світлому кабінеті.',
  },
  footer: {
    note: 'Інформація на сайті має ознайомчий характер і не замінює консультацію лікаря.',
  },
}
