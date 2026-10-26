import {flushPromises,mount} from '@vue/test-utils'
import {defineComponent,h,ref} from 'vue'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({list:vi.fn(),configured:vi.fn(),download:vi.fn(),unpublish:vi.fn(),realtime:vi.fn(),enter:[] as Array<()=>unknown>,open:vi.fn()}))
const profile=ref({id:'admin',role:'admin'})
vi.mock('@ionic/vue',()=>({IonPage:defineComponent({setup:(_,{slots})=>()=>h('main',slots.default?.())}),IonContent:defineComponent({setup:(_,{slots})=>()=>h('section',slots.default?.())}),IonButton:defineComponent({setup:(_,{slots})=>()=>h('button',slots.default?.())}),IonIcon:defineComponent({render:()=>h('span')}),IonSpinner:defineComponent({render:()=>h('span')}),alertController:{create:vi.fn()},onIonViewWillEnter:(callback:()=>unknown)=>mocks.enter.push(callback)}))
vi.mock('@/composables/useSession',()=>({useSession:()=>({profile,signOut:vi.fn()})}))
vi.mock('@/composables/useRealtimeRefresh',()=>({useRealtimeRefresh:mocks.realtime}))
vi.mock('vue-router',()=>({useRouter:()=>({replace:vi.fn()})}))
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true}}))
vi.mock('@capacitor/browser',()=>({Browser:{open:mocks.open}}))
vi.mock('@/components/PortalHeader.vue',()=>({default:defineComponent({render:()=>h('header')})}))
vi.mock('@/components/AppReleaseModal.vue',()=>({default:defineComponent({props:['open','storageConfigured'],render:()=>h('aside')})}))
vi.mock('@/services/appDownloads',()=>({listAppReleases:mocks.list,appStorageConfigured:mocks.configured,appDownloadUrl:mocks.download,unpublishAppRelease:mocks.unpublish,readableAppSize:()=> '55 MB'}))
import AppDownloadsPage from '@/views/AppDownloadsPage.vue'
beforeEach(()=>{vi.clearAllMocks();mocks.enter.length=0;profile.value={id:'admin',role:'admin'};mocks.list.mockResolvedValue([]);mocks.configured.mockResolvedValue(false)})
async function openPage(){const wrapper=mount(AppDownloadsPage);await mocks.enter[0]();await flushPromises();return wrapper}
describe('app download access and setup state',()=>{
  it('shows administrators an honest R2 setup notice and publication control',async()=>{
    const wrapper=await openPage()
    expect(wrapper.text()).toContain('Package uploads need Cloudflare R2 setup')
    expect(wrapper.findAll('.platform-card')).toHaveLength(1)
    expect(wrapper.find('.platform-card h2').text()).toBe('Android')
    expect(wrapper.text()).not.toMatch(/iPhone|iPad|IPA|TestFlight|App Store|Home Screen/)
    expect(wrapper.findAll('button').some(button=>button.text().includes('Publish app version'))).toBe(true)
    wrapper.unmount()
  })
  it.each(['student','teacher','parent'])('lets a completed %s see downloads without admin controls or storage configuration details',async role=>{
    profile.value={id:role,role}
    const wrapper=await openPage()
    expect(wrapper.text()).toContain('Get the Android app')
    expect(wrapper.text()).not.toContain('Package uploads need Cloudflare R2 setup')
    expect(wrapper.findAll('button').some(button=>button.text().includes('Publish app version'))).toBe(false)
    expect(mocks.configured).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('downloads the Android APK and updates published versions through the existing live refresh',async()=>{
    profile.value={id:'parent',role:'parent'}
    const release={id:'release-android',platform:'android',version:'1.0',minimum_os:'Android 9',notes:'',delivery:'android_apk',file_size:55,file_name:'app.apk',sha256:'a'.repeat(64)}
    mocks.list.mockResolvedValue([release])
    mocks.download.mockResolvedValue('https://storage.example.test/app.apk')
    const wrapper=await openPage()
    expect(wrapper.text()).toContain('Download Android app')
    expect(wrapper.text()).toContain('Requires Android 9')
    expect(wrapper.text()).not.toMatch(/iPhone|iPad|IPA|TestFlight|App Store|Home Screen/)
    const download=wrapper.findAll('button').find(button=>button.text()==='Download Android app')!
    await download.trigger('click');await flushPromises()
    expect(mocks.download).toHaveBeenCalledWith(release)
    expect(mocks.open).toHaveBeenCalledWith({url:'https://storage.example.test/app.apk'})
    mocks.list.mockResolvedValue([])
    await mocks.realtime.mock.calls[0][0].onChange();await flushPromises()
    expect(wrapper.text()).not.toContain('Download Android app')
    expect(wrapper.text()).toContain('An Android installer has not been published yet')
    wrapper.unmount()
  })
})
